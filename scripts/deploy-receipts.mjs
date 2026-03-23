import 'dotenv/config';

import { execFileSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { createPublicClient, createWalletClient, encodeAbiParameters, http } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { saveReceiptsContractMetadata } from '../src/services/receipts-chain.js';
import {
  ERC8004_CHAIN_ID,
  ERC8004_REGISTRY_ADDRESS,
  loadErc8004Registration,
} from '../src/services/erc8004.js';

const ARTIFACTS_DIR = resolve(process.cwd(), 'artifacts');
const ABI_PATH = resolve(ARTIFACTS_DIR, 'GhostCartReceipts.abi.json');
const BIN_PATH = resolve(ARTIFACTS_DIR, 'GhostCartReceipts.bin');
const FORGE_OUT_DIR = resolve(ARTIFACTS_DIR, 'forge');
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

function compileContract() {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  execFileSync(
    'forge',
    ['build', '--via-ir', '--root', process.cwd(), '--contracts', 'contracts', '--out', FORGE_OUT_DIR],
    { stdio: 'inherit' }
  );

  const artifactPath = resolve(FORGE_OUT_DIR, 'GhostCartReceipts.sol', 'GhostCartReceipts.json');
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  const abi = artifact.abi;
  const bytecode = artifact.bytecode?.object;

  if (!abi || !bytecode) {
    throw new Error(`Forge artifact missing abi or bytecode: ${artifactPath}`);
  }

  writeFileSync(ABI_PATH, JSON.stringify(abi, null, 2));
  writeFileSync(BIN_PATH, bytecode);

  return { abi, bytecode };
}

async function linkReceiptsToIdentity({ publicClient, walletClient, contractAddress }) {
  const registration = loadErc8004Registration();
  if (!registration?.agentId) {
    return {
      ok: false,
      reason: 'missing_registration',
      message: 'No .erc8004.json registration found; skipping ERC-8004 metadata link',
    };
  }

  if (Number(registration.chainId || ERC8004_CHAIN_ID) !== ERC8004_CHAIN_ID) {
    return {
      ok: false,
      reason: 'wrong_chain',
      message: `ERC-8004 registration is on chain ${registration.chainId}; expected ${ERC8004_CHAIN_ID}`,
    };
  }

  const metadataValue = encodeAbiParameters(
    [{ name: 'receiptsContract', type: 'address' }],
    [contractAddress]
  );
  const nonce = await publicClient.getTransactionCount({
    address: walletClient.account.address,
    blockTag: 'pending',
  });

  const hash = await walletClient.writeContract({
    address: ERC8004_REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'setMetadata',
    args: [BigInt(registration.agentId), ERC8004_METADATA_KEY, metadataValue],
    nonce,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return {
    ok: true,
    metadataKey: ERC8004_METADATA_KEY,
    metadataValue,
    txHash: hash,
    blockNumber: receipt.blockNumber.toString(),
    agentId: registration.agentId,
  };
}

async function main() {
  const rawPrivateKey = getPrivateKey();
  if (!rawPrivateKey) {
    throw new Error('Missing required env: RECEIPTS_PRIVATE_KEY or ERC8004_PRIVATE_KEY');
  }
  const privateKey = rawPrivateKey.startsWith('0x')
    ? rawPrivateKey
    : `0x${rawPrivateKey}`;
  const rpcUrl = process.env.RECEIPTS_RPC_URL?.trim()
    || process.env.ERC8004_RPC_URL?.trim()
    || requireEnv('BASE_RPC_URL');

  const { abi, bytecode } = compileContract();
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

  const balance = await publicClient.getBalance({ address: account.address });
  const startingNonce = await publicClient.getTransactionCount({
    address: account.address,
    blockTag: 'pending',
  });
  console.log(`Deploying receipts contract from ${account.address} on Base`);
  console.log(`Wallet ETH balance: ${balance}`);

  const hash = await walletClient.deployContract({
    abi,
    bytecode: `0x${bytecode.replace(/^0x/, '')}`,
    args: ['0x0000000000000000000000000000000000000000'],
    nonce: startingNonce,
  });

  console.log(`Submitted tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error('Deployment did not return a contract address');
  }

  const metadata = {
    chainId: base.id,
    address: receipt.contractAddress,
    txHash: hash,
    deployedAt: new Date().toISOString(),
    deployer: account.address,
    source: 'contracts/GhostCartReceipts.sol',
  };

  try {
    const link = await linkReceiptsToIdentity({
      publicClient,
      walletClient,
      contractAddress: receipt.contractAddress,
    });
    if (link.ok) {
      metadata.metadataKey = link.metadataKey;
      metadata.metadataTxHash = link.txHash;
      metadata.linkedAgentId = link.agentId;
      metadata.metadataBlockNumber = link.blockNumber;
      console.log(`Linked receipts contract into ERC-8004 metadata via key "${link.metadataKey}"`);
      console.log(`Metadata tx: ${link.txHash}`);
    } else {
      metadata.linkWarning = link.message;
      console.warn(link.message);
    }
  } catch (error) {
    metadata.linkWarning = error.message;
    console.warn(`Could not link receipts contract into ERC-8004 metadata: ${error.message}`);
  }

  saveReceiptsContractMetadata(metadata);
  console.log(`Deployed receipts contract at ${receipt.contractAddress}`);
  console.log(`Saved metadata to ${resolve(process.cwd(), '.receipts-contract.json')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
