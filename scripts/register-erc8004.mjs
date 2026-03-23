import 'dotenv/config';

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, createWalletClient, getContract, http } from 'viem';
import { base } from 'viem/chains';
import { ERC8004_CHAIN_ID, ERC8004_REGISTRY_ADDRESS } from '../src/services/erc8004.js';

const REGISTRATION_PATH = resolve(process.cwd(), '.erc8004.json');
const AGENT_CARD_PATH = '/.well-known/agent-card.json';

const registryAbi = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    anonymous: false,
    type: 'event',
    name: 'Transfer',
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: true, name: 'tokenId', type: 'uint256' },
    ],
  },
];

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function getRpcUrl() {
  return process.env.ERC8004_RPC_URL?.trim() || process.env.BASE_RPC_URL?.trim();
}

async function main() {
  const privateKey = requiredEnv('ERC8004_PRIVATE_KEY');
  const rpcUrl = getRpcUrl();
  if (!rpcUrl) {
    throw new Error('Missing required env: ERC8004_RPC_URL or BASE_RPC_URL');
  }

  const baseUrl = requiredEnv('AGENT_BASE_URL').replace(/\/$/, '');
  const agentURI = `${baseUrl}${AGENT_CARD_PATH}`;
  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(rpcUrl),
  });

  const chainId = await publicClient.getChainId();
  if (chainId !== ERC8004_CHAIN_ID) {
    throw new Error(`Connected to wrong chain: expected ${ERC8004_CHAIN_ID}, got ${chainId}`);
  }

  const contract = getContract({
    address: ERC8004_REGISTRY_ADDRESS,
    abi: registryAbi,
    client: { public: publicClient, wallet: walletClient },
  });

  console.log(`Registering ${agentURI} on Base ERC-8004 registry ${ERC8004_REGISTRY_ADDRESS}...`);
  const txHash = await contract.write.register([agentURI], { account });
  console.log(`Submitted tx: ${txHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const transferLog = receipt.logs.find(
    (log) =>
      log.address.toLowerCase() === ERC8004_REGISTRY_ADDRESS.toLowerCase() &&
      log.topics?.[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  );

  if (!transferLog?.topics?.[3]) {
    throw new Error('Could not extract agentId from registration receipt');
  }

  const agentId = BigInt(transferLog.topics[3]).toString();
  const metadata = {
    standard: 'ERC-8004',
    chainId: ERC8004_CHAIN_ID,
    registryAddress: ERC8004_REGISTRY_ADDRESS,
    agentId,
    owner: account.address,
    agentURI,
    txHash,
    registrationTxn: `https://basescan.org/tx/${txHash}`,
    registeredAt: new Date().toISOString(),
  };

  mkdirSync(dirname(REGISTRATION_PATH), { recursive: true });
  writeFileSync(REGISTRATION_PATH, `${JSON.stringify(metadata, null, 2)}\n`);

  console.log(`Registered agentId ${agentId}`);
  console.log(`Saved registration metadata to ${REGISTRATION_PATH}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
