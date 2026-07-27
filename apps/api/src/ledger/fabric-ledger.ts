import { createPrivateKey } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import * as grpc from '@grpc/grpc-js';
import {
  connect,
  hash,
  signers,
  type Contract,
  type Gateway,
  type Identity,
} from '@hyperledger/fabric-gateway';
import type { AppUser, LedgerReceipt, Shipment, ShipmentHistoryEntry } from '@jixin/shared';
import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';
import type {
  ActionCommand,
  CheckpointCommand,
  ConfirmCommand,
  CreateShipmentCommand,
  Ledger,
  LedgerHealth,
} from './types.js';

interface ConnectionProfile {
  organizations?: Record<
    string,
    {
      mspid?: string;
      peers?: string[];
    }
  >;
  peers?: Record<
    string,
    {
      url?: string;
      tlsCACerts?: { path?: string; pem?: string | string[] };
      grpcOptions?: Record<string, string>;
    }
  >;
}

interface ResolvedConnection {
  mspId: string;
  certPath: string;
  keyPath: string;
  endpoint: string;
  hostAlias: string;
  tlsRootCert: Buffer;
}

type OrgKey = 'org1' | 'org2';

function decodeJson<T>(bytes: Uint8Array, operation: string): T {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as T;
  } catch {
    throw new AppError(502, 'FABRIC_INVALID_RESPONSE', `${operation} returned invalid JSON`);
  }
}

function cleanEndpoint(endpoint: string) {
  return endpoint.replace(/^grpcs?:\/\//, '');
}

function resolveFrom(baseDirectory: string, filePath: string) {
  return isAbsolute(filePath) ? filePath : resolve(baseDirectory, filePath);
}

async function resolvePrivateKeyPath(keyPath: string) {
  const details = await stat(keyPath);
  if (details.isFile()) return keyPath;
  const candidates = (await readdir(keyPath))
    .filter((name) => name.endsWith('_sk') || name.endsWith('.pem'))
    .sort();
  const candidate = candidates[0];
  if (!candidate) throw new Error(`No private key found in ${keyPath}`);
  return resolve(keyPath, candidate);
}

export class FabricLedger implements Ledger {
  readonly mode = 'fabric' as const;
  private profilePromise?: Promise<ConnectionProfile | undefined>;

  constructor(private readonly config: AppConfig['fabric']) {}

  private async profile() {
    if (!this.profilePromise) {
      this.profilePromise = (async () => {
        if (!this.config.connectionProfilePath) return undefined;
        const content = await readFile(resolve(this.config.connectionProfilePath), 'utf8');
        return JSON.parse(content) as ConnectionProfile;
      })();
    }
    return this.profilePromise;
  }

  private orgFor(actor?: AppUser): OrgKey {
    return actor?.role === 'carrier' ? 'org2' : 'org1';
  }

  private async resolveConnection(orgKey: OrgKey): Promise<ResolvedConnection> {
    const org = this.config[orgKey];
    if (!org.certPath || !org.keyPath) {
      throw new AppError(
        503,
        'FABRIC_IDENTITY_NOT_CONFIGURED',
        `${orgKey.toUpperCase()} certificate and private-key paths are required`,
      );
    }

    let endpoint = org.peerEndpoint ?? this.config.peerEndpoint;
    let hostAlias = org.peerHostAlias ?? this.config.peerHostAlias;
    let tlsPath = org.tlsCertPath ?? this.config.tlsCertPath;
    let tlsPem: string | undefined;
    const profile = await this.profile();
    const profileBase = this.config.connectionProfilePath
      ? dirname(resolve(this.config.connectionProfilePath))
      : process.cwd();

    if (profile) {
      const organization = Object.values(profile.organizations ?? {}).find(
        (candidate) => candidate.mspid === org.mspId,
      );
      const peerName = organization?.peers?.[0];
      const peer = peerName ? profile.peers?.[peerName] : undefined;
      endpoint ??= peer?.url;
      hostAlias ??=
        peer?.grpcOptions?.['ssl-target-name-override'] ??
        peer?.grpcOptions?.['grpc.ssl_target_name_override'] ??
        peerName;
      if (!tlsPath && peer?.tlsCACerts?.path) {
        tlsPath = resolveFrom(profileBase, peer.tlsCACerts.path);
      }
      const profilePem = peer?.tlsCACerts?.pem;
      tlsPem = Array.isArray(profilePem) ? profilePem.join('\n') : profilePem;
    }

    if (!endpoint || !hostAlias || (!tlsPath && !tlsPem)) {
      throw new AppError(
        503,
        'FABRIC_PEER_NOT_CONFIGURED',
        `Peer endpoint, TLS CA, and host alias are required for ${org.mspId}`,
      );
    }

    return {
      mspId: org.mspId,
      certPath: resolve(org.certPath),
      keyPath: resolve(org.keyPath),
      endpoint: cleanEndpoint(endpoint),
      hostAlias,
      tlsRootCert: tlsPem ? Buffer.from(tlsPem) : await readFile(resolve(tlsPath!)),
    };
  }

  private async gateway(orgKey: OrgKey) {
    const connection = await this.resolveConnection(orgKey);
    const certificate = await readFile(connection.certPath);
    const privateKeyPath = await resolvePrivateKeyPath(connection.keyPath);
    const privateKey = createPrivateKey(await readFile(privateKeyPath));
    const identity: Identity = { mspId: connection.mspId, credentials: certificate };
    const signer = signers.newPrivateKeySigner(privateKey);
    const client = new grpc.Client(
      connection.endpoint,
      grpc.credentials.createSsl(connection.tlsRootCert),
      {
        'grpc.ssl_target_name_override': connection.hostAlias,
        'grpc.default_authority': connection.hostAlias,
      },
    );
    const gateway = connect({
      client,
      identity,
      signer,
      hash: hash.sha256,
      evaluateOptions: () => ({ deadline: new Date(Date.now() + 5_000) }),
      endorseOptions: () => ({ deadline: new Date(Date.now() + 15_000) }),
      submitOptions: () => ({ deadline: new Date(Date.now() + 5_000) }),
      commitStatusOptions: () => ({ deadline: new Date(Date.now() + 60_000) }),
    });
    return { gateway, client };
  }

  private contract(gateway: Gateway): Contract {
    return gateway.getNetwork(this.config.channelName).getContract(this.config.chaincodeName);
  }

  private async withContract<T>(
    actor: AppUser | undefined,
    operation: (contract: Contract) => Promise<T>,
  ) {
    let resources: { gateway: Gateway; client: grpc.Client } | undefined;
    try {
      resources = await this.gateway(this.orgFor(actor));
      return await operation(this.contract(resources.gateway));
    } catch (error) {
      if (error instanceof AppError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown Fabric Gateway error';
      if (/does not exist|not found/i.test(message)) {
        throw new AppError(
          404,
          'SHIPMENT_NOT_FOUND',
          'Shipment was not found on the Fabric ledger',
        );
      }
      if (/not authorized|forbidden|MSP|access denied/i.test(message)) {
        throw new AppError(
          403,
          'FABRIC_FORBIDDEN',
          'Fabric rejected the submitting identity',
          message,
        );
      }
      if (/state|expected|already|must be/i.test(message)) {
        throw new AppError(
          409,
          'FABRIC_STATE_REJECTED',
          'Fabric rejected the shipment state transition',
          message,
        );
      }
      throw new AppError(502, 'FABRIC_GATEWAY_ERROR', 'Fabric Gateway request failed', message);
    } finally {
      resources?.gateway.close();
      resources?.client.close();
    }
  }

  private async evaluate<T>(transactionName: string, args: string[], actor?: AppUser) {
    return this.withContract(actor, async (contract) => {
      const result = await contract.evaluateTransaction(transactionName, ...args);
      return decodeJson<T>(result, transactionName);
    });
  }

  private async submit(
    transactionName: string,
    args: string[],
    actor: AppUser,
    transientData?: Record<string, Uint8Array>,
  ): Promise<LedgerReceipt> {
    return this.withContract(actor, async (contract) => {
      const proposal = contract.newProposal(transactionName, {
        arguments: args,
        ...(transientData === undefined ? {} : { transientData }),
      });
      const transaction = await proposal.endorse();
      const result = transaction.getResult();
      const commit = await transaction.submit();
      const status = await commit.getStatus();
      if (!status.successful) {
        throw new AppError(502, 'FABRIC_COMMIT_FAILED', 'Fabric transaction was not committed', {
          transactionId: status.transactionId,
          validationCode: status.code,
        });
      }
      const shipment = decodeJson<Shipment>(result, transactionName);
      return {
        transactionId: status.transactionId,
        committedAt: shipment.updatedAt,
        ledgerMode: 'fabric',
        data: shipment,
      };
    });
  }

  async health(): Promise<LedgerHealth> {
    try {
      await this.evaluate<Shipment[]>('GetAllShipments', []);
      return {
        mode: 'fabric',
        status: 'ok',
        network: 'hyperledger-fabric',
        channel: this.config.channelName,
        chaincode: this.config.chaincodeName,
      };
    } catch (error) {
      return {
        mode: 'fabric',
        status: 'degraded',
        network: 'hyperledger-fabric',
        channel: this.config.channelName,
        chaincode: this.config.chaincodeName,
        details: error instanceof Error ? error.message : 'Fabric Gateway unavailable',
      };
    }
  }

  getAllShipments(actor?: AppUser) {
    return this.evaluate<Shipment[]>('GetAllShipments', [], actor);
  }

  readShipment(id: string, actor?: AppUser) {
    return this.evaluate<Shipment>('ReadShipment', [id], actor);
  }

  getShipmentHistory(id: string, actor?: AppUser) {
    return this.evaluate<ShipmentHistoryEntry[]>('GetShipmentHistory', [id], actor);
  }

  createShipment(command: CreateShipmentCommand, actor: AppUser) {
    const payload = {
      ...command,
      shipperId: actor.id,
      shipperName: actor.displayName,
      location: `${command.origin.city} · ${command.origin.detail}`,
      description: '发货方创建运单',
    };
    return this.submit('CreateShipment', [JSON.stringify(payload)], actor);
  }

  acceptShipment(id: string, command: ActionCommand, actor: AppUser) {
    return this.submit(
      'AcceptShipment',
      [
        id,
        JSON.stringify({
          carrierId: actor.id,
          carrierName: actor.displayName,
          actorId: actor.id,
          actorName: actor.displayName,
          ...command,
        }),
      ],
      actor,
    );
  }

  pickupShipment(id: string, command: ActionCommand, actor: AppUser) {
    return this.action('PickupShipment', id, command, actor);
  }

  addCheckpoint(id: string, command: CheckpointCommand, actor: AppUser) {
    return this.action('AddCheckpoint', id, command, actor);
  }

  reportException(id: string, command: ActionCommand, actor: AppUser) {
    return this.action('ReportException', id, command, actor);
  }

  resolveException(id: string, command: ActionCommand, actor: AppUser) {
    return this.action('ResolveException', id, command, actor);
  }

  markDelivered(id: string, command: ActionCommand, actor: AppUser) {
    return this.action('MarkDelivered', id, command, actor);
  }

  confirmReceipt(id: string, command: ConfirmCommand, actor: AppUser) {
    const { deliveryCode, ...publicCommand } = command;
    return this.submit(
      'ConfirmReceipt',
      [
        id,
        JSON.stringify({
          actorId: actor.id,
          actorName: actor.displayName,
          ...publicCommand,
        }),
      ],
      actor,
      { deliveryCode: Buffer.from(deliveryCode, 'utf8') },
    );
  }

  cancelShipment(id: string, command: ActionCommand, actor: AppUser) {
    return this.action('CancelShipment', id, command, actor);
  }

  private action(
    transactionName: string,
    id: string,
    command: ActionCommand | CheckpointCommand | ConfirmCommand,
    actor: AppUser,
  ) {
    return this.submit(
      transactionName,
      [
        id,
        JSON.stringify({
          actorId: actor.id,
          actorName: actor.displayName,
          ...command,
        }),
      ],
      actor,
    );
  }
}
