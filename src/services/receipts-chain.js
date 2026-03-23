import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { createPublicClient, createWalletClient, decodeEventLog, http, parseAbi, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const RECEIPTS_METADATA_PATH = resolve(process.cwd(), '.receipts-contract.json');
const inflightReceiptWrites = new Map();

export const RECEIPTS_ABI = parseAbi([
  'function owner() view returns (address)',
  'function writers(address) view returns (bool)',
  'function nextReceiptId() view returns (uint256)',
  'function receiptIdByPaymentRefHash(bytes32) view returns (uint256)',
  'function setWriter(address writer, bool allowed)',
  'function recordReceipt(uint256 agentId, address payer, uint256 amount, string provider, string merchant, string currency, bytes32 paymentRefHash, bytes32 itemHash, bytes32 metadataHash) returns (uint256 receiptId)',
  'event ReceiptRecorded(uint256 indexed receiptId, uint256 indexed agentId, address indexed payer, string provider, string merchant, string currency, uint256 amount, bytes32 paymentRefHash, bytes32 itemHash, bytes32 metadataHash)'
]);

function getRpcUrl() {
  return process.env.RECEIPTS_RPC_URL?.trim()
    || process.env.ERC8004_RPC_URL?.trim()
    || process.env.BASE_RPC_URL?.trim()
    || 'https://mainnet.base.org';
}

function getPrivateKey() {
  return process.env.RECEIPTS_PRIVATE_KEY?.trim()
    || process.env.ERC8004_PRIVATE_KEY?.trim()
    || null;
}

function getAccount() {
  const privateKey = getPrivateKey();
  if (!privateKey) return null;
  return privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
}

export function hasReceiptsWriterConfig() {
  return !!(getPrivateKey() && loadReceiptsContractMetadata()?.address);
}

export function loadReceiptsContractMetadata() {
  if (!existsSync(RECEIPTS_METADATA_PATH)) return null;
  try {
    return JSON.parse(readFileSync(RECEIPTS_METADATA_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export function saveReceiptsContractMetadata(metadata) {
  writeFileSync(RECEIPTS_METADATA_PATH, JSON.stringify(metadata, null, 2));
}

export function getReceiptsClients() {
  const account = getAccount();
  if (!account) return null;
  const transport = http(getRpcUrl());
  return {
    account,
    publicClient: createPublicClient({ chain: base, transport }),
    walletClient: createWalletClient({ account, chain: base, transport }),
  };
}

export function sha256Hex(value) {
  return `0x${createHash('sha256').update(String(value ?? '')).digest('hex')}`;
}

export function toOnchainAmount(amount, currency) {
  const normalized = String(amount ?? '').trim();
  if (!normalized) return 0n;
  const decimals = String(currency || '').toUpperCase() === 'USDC' ? 6 : 2;
  return parseUnits(normalized, decimals);
}

export function buildReceiptRecordArgs(payment, receipt) {
  const merchant = payment?.metadata?.purchaseIntent?.marketplace
    || payment?.metadata?.merchant
    || 'GhostCart';
  const itemTitle = payment?.metadata?.purchaseIntent?.title
    || payment?.description
    || 'GhostCart purchase';
  const metadata = {
    paymentId: payment?.id,
    receiptId: receipt?.id,
    paidAt: receipt?.paidAt,
    externalId: receipt?.externalId,
    provider: receipt?.provider,
    purchaseIntent: payment?.metadata?.purchaseIntent || null,
  };

  return {
    agentId: BigInt(payment?.agentId || 0),
    payer: receipt?.payerAddress || '0x0000000000000000000000000000000000000000',
    amount: toOnchainAmount(payment?.amount, payment?.currency),
    provider: receipt?.provider || payment?.provider || 'unknown',
    merchant,
    currency: payment?.currency || 'USD',
    paymentRefHash: sha256Hex(`${payment?.provider}:${payment?.externalId || payment?.id}`),
    itemHash: sha256Hex(itemTitle),
    metadataHash: sha256Hex(JSON.stringify(metadata)),
  };
}

export async function writeReceiptOnchain(payment, receipt) {
  const metadata = loadReceiptsContractMetadata();
  const clients = getReceiptsClients();
  if (!metadata?.address || !clients || !payment?.agentId || !receipt) {
    return null;
  }

  const argsRecord = buildReceiptRecordArgs(payment, receipt);
  const lockKey = `${metadata.address}:${argsRecord.paymentRefHash}`;
  const existingWrite = inflightReceiptWrites.get(lockKey);
  if (existingWrite) {
    return existingWrite;
  }

  const run = (async () => {
    const existingReceiptId = await clients.publicClient.readContract({
      address: metadata.address,
      abi: RECEIPTS_ABI,
      functionName: 'receiptIdByPaymentRefHash',
      args: [argsRecord.paymentRefHash],
    });

    if (existingReceiptId && existingReceiptId !== 0n) {
      return {
        contractAddress: metadata.address,
        txHash: null,
        blockNumber: null,
        receiptId: existingReceiptId.toString(),
        reused: true,
      };
    }

    const hash = await clients.walletClient.writeContract({
      address: metadata.address,
      abi: RECEIPTS_ABI,
      functionName: 'recordReceipt',
      args: [
        argsRecord.agentId,
        argsRecord.payer,
        argsRecord.amount,
        argsRecord.provider,
        argsRecord.merchant,
        argsRecord.currency,
        argsRecord.paymentRefHash,
        argsRecord.itemHash,
        argsRecord.metadataHash,
      ],
    });

    const txReceipt = await clients.publicClient.waitForTransactionReceipt({ hash });
    const eventLog = txReceipt.logs.find((log) => {
      if (log.address.toLowerCase() !== metadata.address.toLowerCase()) return false;
      try {
        const decoded = decodeEventLog({
          abi: RECEIPTS_ABI,
          data: log.data,
          topics: log.topics,
        });
        return decoded.eventName === 'ReceiptRecorded';
      } catch {
        return false;
      }
    });

    let receiptId = null;
    if (eventLog) {
      const decoded = decodeEventLog({
        abi: RECEIPTS_ABI,
        data: eventLog.data,
        topics: eventLog.topics,
      });
      receiptId = decoded.args.receiptId?.toString?.() || null;
    }

    if (!receiptId) {
      const mappedReceiptId = await clients.publicClient.readContract({
        address: metadata.address,
        abi: RECEIPTS_ABI,
        functionName: 'receiptIdByPaymentRefHash',
        args: [argsRecord.paymentRefHash],
      });
      receiptId = mappedReceiptId && mappedReceiptId !== 0n ? mappedReceiptId.toString() : null;
    }

    return {
      contractAddress: metadata.address,
      txHash: hash,
      blockNumber: txReceipt.blockNumber.toString(),
      receiptId,
      reused: false,
    };
  })();

  inflightReceiptWrites.set(lockKey, run);
  try {
    return await run;
  } finally {
    inflightReceiptWrites.delete(lockKey);
  }
}
