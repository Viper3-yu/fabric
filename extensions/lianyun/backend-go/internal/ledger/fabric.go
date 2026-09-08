package ledger

import (
	"crypto"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"lianyun-backend/internal/domain"

	"github.com/hyperledger/fabric-gateway/pkg/client"
	"github.com/hyperledger/fabric-gateway/pkg/identity"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
)

type FabricConfig struct {
	MSPID         string
	CertPath      string
	KeyPath       string
	TLSCertPath   string
	PeerEndpoint  string
	PeerHostAlias string
	Channel       string
	Chaincode     string
}

type Fabric struct {
	gateway  *client.Gateway
	contract *client.Contract
	mspID    string
}

type fabricShipment struct {
	ShipmentID     string   `json:"shipmentId"`
	OriginHub      string   `json:"originHub"`
	DestinationHub string   `json:"destinationHub"`
	Status         string   `json:"status"`
	OwnerOrg       string   `json:"ownerOrg"`
	CarrierOrg     string   `json:"carrierOrg"`
	ParcelIDs      []string `json:"parcelIds"`
}

type fabricEvent struct {
	EventID      string `json:"eventId"`
	EventType    string `json:"eventType"`
	HubCode      string `json:"hubCode"`
	ActorOrg     string `json:"actorOrg"`
	ActorID      string `json:"actorId"`
	Remark       string `json:"remark"`
	Severity     string `json:"severity"`
	EvidenceHash string `json:"evidenceHash"`
	Timestamp    string `json:"timestamp"`
	TxID         string `json:"txId"`
}

func firstFile(dir string) (string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}
	for _, e := range entries {
		if !e.IsDir() {
			return filepath.Join(dir, e.Name()), nil
		}
	}
	return "", fmt.Errorf("目录 %s 中没有文件", dir)
}
func readCertificate(path string) (*x509.Certificate, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return identity.CertificateFromPEM(raw)
}
func readPrivateKey(path string) (crypto.PrivateKey, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return identity.PrivateKeyFromPEM(raw)
}

func readTLSCertificatePool(path string) (*x509.CertPool, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(raw) {
		return nil, fmt.Errorf("无法解析 TLS CA 证书: %s", path)
	}
	return pool, nil
}

func NewFabric(cfg FabricConfig) (*Fabric, error) {
	cert, err := readCertificate(cfg.CertPath)
	if err != nil {
		return nil, err
	}
	key, err := readPrivateKey(cfg.KeyPath)
	if err != nil {
		return nil, err
	}
	tlsCert, err := readTLSCertificatePool(cfg.TLSCertPath)
	if err != nil {
		return nil, err
	}
	id, err := identity.NewX509Identity(cfg.MSPID, cert)
	if err != nil {
		return nil, err
	}
	signer, err := identity.NewPrivateKeySign(key)
	if err != nil {
		return nil, err
	}
	connection, err := grpc.Dial(cfg.PeerEndpoint, grpc.WithTransportCredentials(credentials.NewClientTLSFromCert(tlsCert, cfg.PeerHostAlias)))
	if err != nil {
		return nil, err
	}
	gateway, err := client.Connect(id, client.WithSign(signer), client.WithClientConnection(connection), client.WithEvaluateTimeout(5*time.Second), client.WithEndorseTimeout(15*time.Second), client.WithSubmitTimeout(15*time.Second), client.WithCommitStatusTimeout(60*time.Second))
	if err != nil {
		return nil, err
	}
	return &Fabric{gateway: gateway, contract: gateway.GetNetwork(cfg.Channel).GetContract(cfg.Chaincode), mspID: cfg.MSPID}, nil
}
func (f *Fabric) Close() { f.gateway.Close() }
func (f *Fabric) ReadShipment(id string) (domain.Shipment, error) {
	raw, err := f.contract.EvaluateTransaction("ReadShipment", id)
	if err != nil {
		return domain.Shipment{}, err
	}
	var in fabricShipment
	if err = json.Unmarshal(raw, &in); err != nil {
		return domain.Shipment{}, err
	}
	out := domain.Shipment{ID: in.ShipmentID, Origin: in.OriginHub, Destination: in.DestinationHub, Status: in.Status, OwnerOrg: in.OwnerOrg, CarrierOrg: in.CarrierOrg}
	for _, parcelID := range in.ParcelIDs {
		out.Parcels = append(out.Parcels, domain.Parcel{ID: parcelID, Status: "ON_CHAIN"})
	}
	out.Events, err = f.QueryTrace(id)
	return out, err
}
func (f *Fabric) QueryTrace(id string) ([]domain.TrackingEvent, error) {
	raw, err := f.contract.EvaluateTransaction("QueryTrace", id)
	if err != nil {
		return nil, err
	}
	var items []fabricEvent
	if err = json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	out := make([]domain.TrackingEvent, 0, len(items))
	for _, e := range items {
		out = append(out, domain.TrackingEvent{ID: e.EventID, Type: e.EventType, HubCode: e.HubCode, ActorOrg: e.ActorOrg, ActorName: e.ActorID, Remark: e.Remark, Severity: e.Severity, EvidenceHash: e.EvidenceHash, At: e.Timestamp, TxID: e.TxID})
	}
	return out, nil
}
func (f *Fabric) AppendEvent(id string, event domain.TrackingEvent) (domain.TrackingEvent, error) {
	before, err := f.QueryTrace(id)
	if err != nil {
		return event, err
	}
	known := make(map[string]struct{}, len(before))
	for _, existing := range before {
		known[existing.ID] = struct{}{}
	}

	_, err = f.contract.SubmitTransaction("RecordNodeEvent", id, event.Type, event.HubCode, f.mspID, event.ActorName, event.Remark)
	if err != nil {
		return event, err
	}
	events, err := f.QueryTrace(id)
	if err != nil {
		return event, err
	}
	for _, candidate := range events {
		if _, existed := known[candidate.ID]; !existed {
			return candidate, nil
		}
	}
	return event, fmt.Errorf("交易提交成功但未查询到新增事件")
}

func (f *Fabric) InitiateHandover(shipmentID, handoverID, fromHub, toHub, carrierOrg string) (domain.Handover, error) {
	raw, err := f.contract.SubmitTransaction("InitiateHandover", handoverID, shipmentID, fromHub, toHub, carrierOrg, f.mspID)
	if err != nil {
		return domain.Handover{}, err
	}
	var handover domain.Handover
	if err := json.Unmarshal(raw, &handover); err != nil {
		return domain.Handover{}, err
	}
	return handover, nil
}

func (f *Fabric) ConfirmHandover(handoverID string) (domain.Handover, error) {
	raw, err := f.contract.SubmitTransaction("ConfirmHandover", handoverID, f.mspID)
	if err != nil {
		return domain.Handover{}, err
	}
	var handover domain.Handover
	if err := json.Unmarshal(raw, &handover); err != nil {
		return domain.Handover{}, err
	}
	return handover, nil
}
