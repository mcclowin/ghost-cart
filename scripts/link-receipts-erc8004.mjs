import 'dotenv/config';

import { createPublicClient, createWalletClient, encodeAbiParameters, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import {
  ERC8004_CHAIN_ID,
  ERC8004_REGISTRY_ADDRESS,
  loadErc8004Registration,
  loadReceiptsRegistration,
} from '../src/services/erc8004.js';
import { saveReceiptsContractMetadata } from '../src/services/receipts-chain.js';

const ERC8004_METADATA_KEY = 'receiptsContract';
const IDENTITY_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'setMetadata',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'metadataKey', type: 'string' },
      { name: 'metadataValue', type: 'bytes' },
    ],
    outputs: [],
  },
];

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function getPrivateKey() {
  return process.env.RECEIPTS_PRIVATE_KEY?.trim()
    || process.env.ERC8004_PRIVATE_KEY?.trim()
    || null;
}

function getRpcUrl() {
  return process.env.RECEIPTS_RPC_URL?.trim()
    || process.env.ERC8004_RPC_URL?.trim()
    || requireEnv('BASE_RPC_URL');
}

async function main() {
  const registration = loadErc8004Registration();
  if (!registration?.agentId) {
    throw new Error('Missing .erc8004.json agent registration metadata');
  }

  const receipts = loadReceiptsRegistration();
  if (!receipts?.address) {
    throw new Error('Missing .receipts-contract.json receipts deployment metadata');
  }

  if (Number(registration.chainId || ERC8004_CHAIN_ID) !== ERC8004_CHAIN_ID) {
    throw new Error(`ERC-8004 registration is on chain ${registration.chainId}; expected ${ERC8004_CHAIN_ID}`);
  }

  const rawPrivateKey = getPrivateKey();
  if (!rawPrivateKey) {
    throw new Error('Missing required env: RECEIPTS_PRIVATE_KEY or ERC8004_PRIVATE_KEY');
  }

  const privateKey = rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`;
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: base, transport: http(getRpcUrl()) });
  const walletClient = createWalletClient({ account, chain: base, transport: http(getRpcUrl()) });

  const metadataValue = encodeAbiParameters(
    [{ name: 'receiptsContract', type: 'address' }],
    [receipts.address]
  );
  const nonce = await publicClient.getTransactionCount({
    address: account.address,
    blockTag: 'pending',
  });

  console.log(`Linking receipts contract ${receipts.address} to ERC-8004 agent ${registration.agentId}`);
  const hash = await walletClient.writeContract({
    address: ERC8004_REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'setMetadata',
    args: [BigInt(registration.agentId), ERC8004_METADATA_KEY, metadataValue],
    nonce,
  });

  console.log(`Submitted metadata tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  saveReceiptsContractMetadata({
    ...receipts,
    metadataKey: ERC8004_METADATA_KEY,
    metadataTxHash: hash,
    linkedAgentId: registration.agentId,
    metadataBlockNumber: receipt.blockNumber.toString(),
  });

  console.log(`Linked receipts contract into ERC-8004 metadata for agent ${registration.agentId}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
