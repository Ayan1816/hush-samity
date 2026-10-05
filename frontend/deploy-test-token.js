/**
 * Deploy TestUSD (6 decimals) to Sepolia and mint 1000 TUSD to the deployer.
 *
 * Reads PRIVATE_KEY and SEPOLIA_RPC_URL with dotenv from frontend/.env and
 * the repository root .env. The frontend file overrides the root file.
 * Values already present in the shell are ignored. The private key and the
 * RPC URL are never printed.
 *
 * Usage (from frontend/):
 *   npm install --no-save --no-package-lock solc@0.8.37 dotenv@16.4.7
 *   node deploy-test-token.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const solc = require('solc');
const {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
} = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { sepolia } = require('viem/chains');

const TEST_USD_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract TestUSD is ERC20 {
    constructor() ERC20("Test USD", "TUSD") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
`;

/** 1000 TUSD at 6 decimals. */
const MINT_AMOUNT = 1000000000n;
const RECEIPT_TIMEOUT_MS = 180_000;

const NODE_MODULE_ROOTS = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(__dirname, '..', 'node_modules'),
];

let privateKeyForRedaction = '';
let rpcUrlForRedaction = '';

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir, '..');
    dir = parent;
  }
}

function gitignoreListsEnv(contents) {
  let listed = false;
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const negated = trimmed.startsWith('!');
    const pattern = (negated ? trimmed.slice(1) : trimmed).trim();
    if (pattern === '.env' || pattern === '**/.env') listed = !negated;
  }
  return listed;
}

function ensureEnvIsGitignored(repoRoot) {
  const gitignorePath = path.join(repoRoot, '.gitignore');
  const contents = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf8')
    : '';

  if (gitignoreListsEnv(contents)) {
    console.log('Security check passed: .env is listed in .gitignore.');
    return;
  }

  const next = contents.length === 0 || contents.endsWith('\n')
    ? `${contents}.env\n`
    : `${contents}\n.env\n`;
  fs.writeFileSync(gitignorePath, next, 'utf8');
  console.log('Security check: added .env to .gitignore before continuing.');
}

function loadEnv(repoRoot) {
  const scriptEnv = path.join(__dirname, '.env');
  const rootEnv = path.join(repoRoot, '.env');
  const files = [];
  if (fs.existsSync(rootEnv)) files.push(rootEnv);
  if (scriptEnv !== rootEnv && fs.existsSync(scriptEnv)) files.push(scriptEnv);

  if (files.length === 0) {
    throw new Error(
      'No .env file found. Create frontend/.env or the repository root .env with PRIVATE_KEY and SEPOLIA_RPC_URL.',
    );
  }

  // Parse the files directly so a key already exported in the shell cannot
  // replace, or leak through, the values this script deploys with.
  const merged = {};
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      throw new Error(`Could not read ${path.relative(repoRoot, file) || '.env'}.`);
    }
    Object.assign(merged, dotenv.parse(text));
    console.log(`Loaded ${path.relative(repoRoot, file) || '.env'}`);
  }
  return merged;
}

function requireEnvValue(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `${name} is missing. Add it to frontend/.env or the repository root .env and run again.`,
    );
  }
  return value.trim();
}

function normalizePrivateKey(raw) {
  const stripped = raw.replace(/^["']|["']$/g, '').trim();
  const hex = stripped.startsWith('0x') || stripped.startsWith('0X')
    ? stripped.slice(2)
    : stripped;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'PRIVATE_KEY must be a 32-byte hex string (64 hex characters, with or without a 0x prefix).',
    );
  }
  return `0x${hex}`;
}

function normalizeImportPath(importPath) {
  const parts = String(importPath).replace(/\\/g, '/').split('/');
  const stack = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
}

function findImports(importPath) {
  const normalized = normalizeImportPath(importPath);
  if (!normalized) {
    return { error: `Refusing import that escapes node_modules: ${importPath}` };
  }

  const marker = 'node_modules/';
  const markerIndex = normalized.lastIndexOf(marker);
  const relative = markerIndex >= 0
    ? normalized.slice(markerIndex + marker.length)
    : normalized;

  for (const root of NODE_MODULE_ROOTS) {
    const candidate = path.resolve(root, relative);
    const fromRoot = path.relative(root, candidate);
    if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) continue;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return { contents: fs.readFileSync(candidate, 'utf8') };
    }
  }

  return { error: `File not found in node_modules: ${importPath}` };
}

function compileTestUsd() {
  const openZeppelin = findImports('@openzeppelin/contracts/token/ERC20/ERC20.sol');
  if (openZeppelin.error) {
    throw new Error(
      'Could not read @openzeppelin/contracts from node_modules. Install it from the repository root with pnpm install, or from frontend/ run: npm install --no-save --no-package-lock @openzeppelin/contracts@5.4.0',
    );
  }

  console.log('Compiling TestUSD with solc...');

  const input = {
    language: 'Solidity',
    sources: {
      'TestUSD.sol': { content: TEST_USD_SOURCE },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Cancun bytecode runs on Sepolia. This contract does not need newer opcodes.
      evmVersion: 'cancun',
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object'],
        },
      },
    },
  };

  const raw = solc.compile(JSON.stringify(input), { import: findImports });
  const output = JSON.parse(raw);
  const errors = Array.isArray(output.errors) ? output.errors : [];
  const fatal = errors.filter((entry) => entry.severity === 'error');

  for (const warning of errors) {
    if (warning.severity === 'warning') {
      console.warn(warning.formattedMessage || warning.message);
    }
  }

  if (fatal.length > 0) {
    throw new Error(
      `Solidity compilation failed:\n${fatal
        .map((entry) => entry.formattedMessage || entry.message)
        .join('\n')}`,
    );
  }

  const compiled = output.contracts
    && output.contracts['TestUSD.sol']
    && output.contracts['TestUSD.sol'].TestUSD;

  if (!compiled || !compiled.abi || !compiled.evm || !compiled.evm.bytecode) {
    throw new Error('Compiler output did not include the TestUSD ABI and bytecode.');
  }

  const object = compiled.evm.bytecode.object;
  if (typeof object !== 'string' || object.length === 0) {
    throw new Error('Compiler output did not include TestUSD bytecode.');
  }
  if (object.includes('_') || object.includes('$')) {
    throw new Error('TestUSD bytecode still contains unlinked library placeholders.');
  }

  const hasMint = compiled.abi.some(
    (item) => item.type === 'function' && item.name === 'mint',
  );
  if (!hasMint) {
    throw new Error('Compiled TestUSD ABI is missing mint.');
  }

  console.log(`Compiled TestUSD (${object.length / 2} bytecode bytes).`);
  return {
    abi: compiled.abi,
    bytecode: `0x${object}`,
  };
}

function redact(text) {
  let out = String(text);
  if (privateKeyForRedaction) {
    out = out.split(privateKeyForRedaction).join('[REDACTED]');
    out = out.split(privateKeyForRedaction.slice(2)).join('[REDACTED]');
  }
  if (rpcUrlForRedaction) {
    out = out.split(rpcUrlForRedaction).join('[REDACTED_RPC]');
  }
  return out;
}

function formatError(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  const parts = [];
  if (typeof error.shortMessage === 'string' && error.shortMessage) {
    parts.push(error.shortMessage);
  }
  if (typeof error.message === 'string' && error.message && !parts.includes(error.message)) {
    parts.push(error.message);
  }
  if (typeof error.details === 'string' && error.details && !parts.includes(error.details)) {
    parts.push(error.details);
  }
  return parts.join('\n') || 'Unknown error';
}

async function assertReceipt(publicClient, hash, label) {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 1,
    timeout: RECEIPT_TIMEOUT_MS,
  });
  if (receipt.status !== 'success') {
    throw new Error(`${label} transaction reverted: ${hash}`);
  }
  return receipt;
}

async function main() {
  const repoRoot = findRepoRoot(__dirname);
  ensureEnvIsGitignored(repoRoot);
  const env = loadEnv(repoRoot);

  const privateKey = normalizePrivateKey(requireEnvValue(env, 'PRIVATE_KEY'));
  const rpcUrl = requireEnvValue(env, 'SEPOLIA_RPC_URL');
  privateKeyForRedaction = privateKey;
  rpcUrlForRedaction = rpcUrl;

  let rpcHost = '';
  try {
    const parsed = new URL(rpcUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('bad protocol');
    }
    rpcHost = parsed.host;
  } catch {
    throw new Error('SEPOLIA_RPC_URL must be an http or https URL.');
  }

  const { abi, bytecode } = compileTestUsd();
  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpcUrl),
  });

  console.log(`Deployer: ${account.address}`);
  console.log(`RPC host: ${rpcHost}`);

  const chainId = await publicClient.getChainId();
  if (chainId !== sepolia.id) {
    throw new Error(
      `SEPOLIA_RPC_URL returned chain id ${chainId}, not Sepolia (${sepolia.id}). Refusing to deploy.`,
    );
  }

  const balance = await publicClient.getBalance({ address: account.address });
  if (balance === 0n) {
    throw new Error(
      `Deployer ${account.address} has 0 ETH on Sepolia. Fund the account with testnet ETH and run again.`,
    );
  }
  console.log(`Sepolia balance: ${formatEther(balance)} ETH`);

  console.log('Deploying TestUSD...');
  const deployHash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [],
  });
  console.log(`Deploy transaction: ${deployHash}`);

  const deployReceipt = await assertReceipt(publicClient, deployHash, 'Deployment');
  if (!deployReceipt.contractAddress) {
    throw new Error(`Deployment transaction ${deployHash} did not return a contract address.`);
  }

  const contractAddress = deployReceipt.contractAddress;
  console.log(`TestUSD deployed at: ${contractAddress}`);
  console.log(`Etherscan: https://sepolia.etherscan.io/address/${contractAddress}`);

  console.log(`Minting ${MINT_AMOUNT.toString()} base units (1000 TUSD) to ${account.address}...`);
  const mintHash = await walletClient.writeContract({
    address: contractAddress,
    abi,
    functionName: 'mint',
    args: [account.address, MINT_AMOUNT],
  });
  console.log(`Mint transaction: ${mintHash}`);

  await assertReceipt(publicClient, mintHash, 'Mint');
  console.log(`Mint confirmed: https://sepolia.etherscan.io/tx/${mintHash}`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${redact(formatError(error))}\n`, () => {
      process.exit(1);
    });
  });
}

module.exports = {
  compileTestUsd,
  findImports,
  gitignoreListsEnv,
};
