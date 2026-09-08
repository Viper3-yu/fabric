package ledger

import (
	"crypto"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"tower-api/internal/domain"

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

// ledgerShipment mirrors the unified logistics chaincode's Shipment document.
type ledgerShipment struct {
	ID             string `json:"id"`
	TrackingNumber string `json:"trackingNumber"`
	Status         string `json:"status"`
	ShipperName    string `json:"shipperName"`
	CarrierID      string `json:"carrierId"`
	Origin         struct {
		Province string `json:"province"`
		City     string `json:"city"`
	} `json:"origin"`
	Destination struct {
		Province string `json:"province"`
		City     string `json:"city"`
	} `json:"destination"`
	Events []ledgerEvent `json:"events"`
}

// ledgerEvent mirrors model.ShipmentEvent of the unified chaincode.
type ledgerEvent struct {
	Sequence     int      `json:"sequence"`
	Type         string   `json:"type"`
	Location     string   `json:"location"`
	Description  string   `json:"description"`
	ActorName    string   `json:"actorName"`
	MSPID        string   `json:"mspId"`
	TxID         string   `json:"txId"`
	Timestamp    string   `json:"timestamp"`
	EvidenceHash string   `json:"evidenceHash"`
	Temperature  *float64 `json:"temperature"`
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

func addressCity(province, city string) string {
	if trimmed := strings.TrimSpace(city); trimmed != "" {
		return trimmed
	}
	return strings.TrimSpace(province)
}

func toTrackingEvent(event ledgerEvent) domain.TrackingEvent {
	severity := ""
	if event.Type == "EXCEPTION_REPORTED" {
		severity = "high"
	}
	return domain.TrackingEvent{
		ID:           fmt.Sprintf("evt-%04d", event.Sequence),
		Type:         event.Type,
		HubCode:      event.Location,
		ActorOrg:     event.MSPID,
		ActorName:    event.ActorName,
		Remark:       event.Description,
		Severity:     severity,
		EvidenceHash: event.EvidenceHash,
		At:           event.Timestamp,
		TxID:         event.TxID,
		Temperature:  event.Temperature,
	}
}

// readLedgerShipment fetches the unified shipment document once; all other
// read paths reuse it instead of issuing additional ledger queries.
func (f *Fabric) readLedgerShipment(id string) (ledgerShipment, error) {
	raw, err := f.contract.EvaluateTransaction("ReadShipment", id)
	if err != nil {
		return ledgerShipment{}, err
	}
	var shipment ledgerShipment
	if err := json.Unmarshal(raw, &shipment); err != nil {
		return ledgerShipment{}, fmt.Errorf("链上运单 %q 不是有效的 JSON 文档: %w", id, err)
	}
	return shipment, nil
}

func (f *Fabric) ReadShipment(id string) (domain.Shipment, error) {
	shipment, err := f.readLedgerShipment(id)
	if err != nil {
		return domain.Shipment{}, err
	}
	out := domain.Shipment{
		ID:          shipment.ID,
		Origin:      addressCity(shipment.Origin.Province, shipment.Origin.City),
		Destination: addressCity(shipment.Destination.Province, shipment.Destination.City),
		Status:      shipment.Status,
		OwnerOrg:    "Org1MSP",
	}
	if shipment.CarrierID != "" {
		out.CarrierOrg = "Org2MSP"
	}
	for _, event := range shipment.Events {
		out.Events = append(out.Events, toTrackingEvent(event))
	}
	out.Parcels, err = f.QueryParcels(id)
	return out, err
}

// QueryParcels reads the parcel list of a shipment from the unified chaincode.
func (f *Fabric) QueryParcels(id string) ([]domain.Parcel, error) {
	raw, err := f.contract.EvaluateTransaction("GetParcels", id)
	if err != nil {
		return nil, err
	}
	var parcels []domain.Parcel
	if err := json.Unmarshal(raw, &parcels); err != nil {
		return nil, fmt.Errorf("链上包裹列表 %q 不是有效的 JSON: %w", id, err)
	}
	return parcels, nil
}

func (f *Fabric) QueryTrace(id string) ([]domain.TrackingEvent, error) {
	shipment, err := f.readLedgerShipment(id)
	if err != nil {
		return nil, err
	}
	events := make([]domain.TrackingEvent, 0, len(shipment.Events))
	for _, event := range shipment.Events {
		events = append(events, toTrackingEvent(event))
	}
	return events, nil
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
	raw, err := f.contract.SubmitTransaction("InitiateHandover", handoverID, shipmentID, fromHub, toHub, carrierOrg)
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
	raw, err := f.contract.SubmitTransaction("ConfirmHandover", handoverID)
	if err != nil {
		return domain.Handover{}, err
	}
	var handover domain.Handover
	if err := json.Unmarshal(raw, &handover); err != nil {
		return domain.Handover{}, err
	}
	return handover, nil
}
