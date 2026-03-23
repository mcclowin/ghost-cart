import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export const ERC8004_REGISTRY_ADDRESS = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
export const ERC8004_CHAIN_ID = 8453;
const ERC8004_METADATA_PATH = resolve(process.cwd(), '.erc8004.json');
const RECEIPTS_METADATA_PATH = resolve(process.cwd(), '.receipts-contract.json');

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

export function loadErc8004Registration() {
  if (!existsSync(ERC8004_METADATA_PATH)) return null;
  return readJsonFile(ERC8004_METADATA_PATH);
}

export function loadReceiptsRegistration() {
  if (!existsSync(RECEIPTS_METADATA_PATH)) return null;
  return readJsonFile(RECEIPTS_METADATA_PATH);
}

export function getPublicBaseUrl(req) {
  const configured = process.env.AGENT_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');

  if (!req) return null;
  return `${req.protocol}://${req.get('host')}`;
}

export function buildAgentCard(req) {
  const registration = loadErc8004Registration();
  const receipts = loadReceiptsRegistration();
  const baseUrl = getPublicBaseUrl(req);
  const skillUrl = baseUrl ? `${baseUrl}/skill.md` : null;
  const apiUrl = baseUrl ? `${baseUrl}/api` : null;
  const imageUrl = baseUrl ? `${baseUrl}/logo.png` : 'https://github.com/mcclowin/ghost-cart/raw/main/public/logo.png';

  const card = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: process.env.AGENT_NAME?.trim() || 'GhostCart',
    description: process.env.AGENT_DESCRIPTION?.trim() || 'GhostCart is a privacy-first AI purchasing agent that searches across marketplaces and buys on behalf of users. Built by Mohammed and McClowin.',
    image: imageUrl,
    services: [
      ...(skillUrl ? [{ name: 'A2A', endpoint: skillUrl, version: '1.0.0' }] : []),
      ...(apiUrl ? [{ name: 'API', endpoint: apiUrl, version: '1.0.0' }] : []),
    ],
    x402Support: true,
    active: true,
    supportedTrust: ['reputation'],
    capabilities: ['search', 'compare', 'purchase'],
    pricing: {
      search: '0.50 USDC',
      purchaseFee: '10-15%',
    },
  };

  if (registration) {
    card.registry = {
      standard: 'ERC-8004',
      chainId: registration.chainId || ERC8004_CHAIN_ID,
      registryAddress: registration.registryAddress || ERC8004_REGISTRY_ADDRESS,
      agentId: registration.agentId ?? null,
      owner: registration.owner ?? null,
      registrationTxn: registration.registrationTxn || null,
      agentURI: registration.agentURI || null,
    };
  }

  if (receipts?.address) {
    card.receipts = {
      chainId: receipts.chainId || ERC8004_CHAIN_ID,
      contractAddress: receipts.address,
      deployer: receipts.deployer || null,
      deploymentTxn: receipts.txHash ? `https://basescan.org/tx/${receipts.txHash}` : null,
      metadataKey: receipts.metadataKey || null,
      metadataTxn: receipts.metadataTxHash ? `https://basescan.org/tx/${receipts.metadataTxHash}` : null,
    };
  }

  return card;
}
