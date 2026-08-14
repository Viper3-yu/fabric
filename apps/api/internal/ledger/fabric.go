package ledger

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/Viper3-yu/fabric/apps/api/internal/apperror"
	"github.com/Viper3-yu/fabric/apps/api/internal/config"
	"github.com/Viper3-yu/fabric/chaincode/logistics/model"
	"github.com/hyperledger/fabric-gateway/pkg/client"
	"github.com/hyperledger/fabric-gateway/pkg/identity"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
)

type connectionProfile struct {
	Organizations map[string]struct {
		MSPID string   `json:"mspid"`
		Peers []string `json:"peers"`
	} `json:"organizations"`
	Peers map[string]struct {
		URL        string `json:"url"`
		TLSCACerts struct {
			Path string      `json:"path"`
			PEM  interface{} `json:"pem"`
		} `json:"tlsCACerts"`
		GRPCOptions map[string]any `json:"grpcOptions"`
	} `json:"peers"`
}

type resolvedConnection struct {
	MSPID          string
	CertPath       string
	KeyPath        string
	Endpoint       string
	HostAlias      string
	TLSRootCertPEM []byte
}

type Fabric struct {
	config  config.FabricConfig
	profile *connectionProfile
}

func NewFabric(cfg config.FabricConfig) (*Fabric, error) {
	fabric := &Fabric{config: cfg}
	if cfg.ConnectionProfilePath != "" {
		content, err := os.ReadFile(cfg.ConnectionProfilePath)
		if err != nil {
			return nil, err
		}
		var profile connectionProfile
		if err := json.Unmarshal(content, &profile); err != nil {
			return nil, fmt.Errorf("parse Fabric connection profile: %w", err)
		}
		fabric.profile = &profile
	}
	return fabric, nil
}

func (f *Fabric) Mode() string {
	return "fabric"
}

func (f *Fabric) Health(ctx context.Context) Health {
	_, err := f.evaluate("Health", nil, nil)
	result := Health{
		Mode: "fabric", Network: "hyperledger-fabric",
		Channel: f.config.ChannelName, Chaincode: f.config.ChaincodeName,
	}
	if err != nil {
		result.Status = "degraded"
		result.Details = err.Error()
		log.Printf("fabric health degraded: %v", err)
		return result
	}
	result.Status = "ok"
	return result
}

func (f *Fabric) ReadShipmentByTracking(
	ctx context.Context,
	trackingNumber string,
	actor *model.User,
) (model.Shipment, error) {
	shipment, err := f.ReadShipment(ctx, trackingNumber, actor)
	if err != nil {
		var appError *apperror.Error
		if errors.As(err, &appError) && appError.Code == "SHIPMENT_NOT_FOUND" {
			return model.Shipment{}, apperror.New(
				404, "TRACKING_NOT_FOUND", "No shipment matches this tracking number",
			)
		}
	}
	return shipment, err
}

func (f *Fabric) GetAllShipments(_ context.Context, actor *model.User) ([]model.Shipment, error) {
	content, err := f.evaluate("GetAllShipments", nil, actor)
	if err != nil {
		return nil, err
	}
	var shipments []model.Shipment
	if err := decodeFabricJSON(content, "GetAllShipments", &shipments); err != nil {
		return nil, err
	}
	return shipments, nil
}

func (f *Fabric) ReadShipment(
	_ context.Context,
	id string,
	actor *model.User,
) (model.Shipment, error) {
	content, err := f.evaluate("ReadShipment", []string{id}, actor)
	if err != nil {
		return model.Shipment{}, err
	}
	var shipment model.Shipment
	if err := decodeFabricJSON(content, "ReadShipment", &shipment); err != nil {
		return model.Shipment{}, err
	}
	return shipment, nil
}

func (f *Fabric) GetShipmentHistory(
	_ context.Context,
	id string,
	actor *model.User,
) ([]model.ShipmentHistoryEntry, error) {
	content, err := f.evaluate("GetShipmentHistory", []string{id}, actor)
	if err != nil {
		return nil, err
	}
	var history []model.ShipmentHistoryEntry
	if err := decodeFabricJSON(content, "GetShipmentHistory", &history); err != nil {
		return nil, err
	}
	return history, nil
}

func (f *Fabric) CreateShipment(
	_ context.Context,
	command CreateShipmentCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	payload := map[string]any{
		"id": command.ID, "trackingNumber": command.TrackingNumber,
		"shipperId": actor.ID, "shipperName": actor.DisplayName,
		"origin": command.Origin, "destination": command.Destination,
		"goods": command.Goods, "recipientMasked": command.RecipientMasked,
		"expectedDeliveryDate": command.ExpectedDeliveryDate,
		"deliveryCodeHash":     command.DeliveryCodeHash,
		"location":             command.Origin.City + " · " + command.Origin.Detail,
		"description":          "发货方创建运单",
	}
	if command.TemperatureRange != nil {
		payload["temperatureRange"] = command.TemperatureRange
	}
	if command.DocumentHash != "" {
		payload["documentHash"] = command.DocumentHash
	}
	content, _ := json.Marshal(payload)
	return f.submit("CreateShipment", []string{string(content)}, actor, nil)
}

func (f *Fabric) AcceptShipment(
	_ context.Context,
	id string,
	command ActionCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	payload := actionPayload(command, actor)
	payload["carrierId"] = actor.ID
	payload["carrierName"] = actor.DisplayName
	content, _ := json.Marshal(payload)
	return f.submit("AcceptShipment", []string{id, string(content)}, actor, nil)
}

func (f *Fabric) PickupShipment(
	_ context.Context,
	id string,
	command ActionCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return f.submitAction("PickupShipment", id, command, actor)
}

func (f *Fabric) AddCheckpoint(
	_ context.Context,
	id string,
	command ActionCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return f.submitAction("AddCheckpoint", id, command, actor)
}

func (f *Fabric) ReportException(
	_ context.Context,
	id string,
	command ActionCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return f.submitAction("ReportException", id, command, actor)
}

func (f *Fabric) ResolveException(
	_ context.Context,
	id string,
	command ActionCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return f.submitAction("ResolveException", id, command, actor)
}

func (f *Fabric) MarkDelivered(
	_ context.Context,
	id string,
	command ActionCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return f.submitAction("MarkDelivered", id, command, actor)
}

func (f *Fabric) ConfirmReceipt(
	_ context.Context,
	id string,
	command ConfirmCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	content, _ := json.Marshal(actionPayload(command.ActionCommand, actor))
	return f.submit(
		"ConfirmReceipt",
		[]string{id, string(content)},
		actor,
		map[string][]byte{"deliveryCode": []byte(command.DeliveryCode)},
	)
}

func (f *Fabric) CancelShipment(
	_ context.Context,
	id string,
	command ActionCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	return f.submitAction("CancelShipment", id, command, actor)
}

func (f *Fabric) submitAction(
	transactionName, id string,
	command ActionCommand,
	actor model.User,
) (model.LedgerReceipt, error) {
	content, _ := json.Marshal(actionPayload(command, actor))
	return f.submit(transactionName, []string{id, string(content)}, actor, nil)
}

func actionPayload(command ActionCommand, actor model.User) map[string]any {
	payload := map[string]any{"actorId": actor.ID, "actorName": actor.DisplayName}
	if command.Location != "" {
		payload["location"] = command.Location
	}
	if command.Description != "" {
		payload["description"] = command.Description
	}
	if command.EvidenceHash != "" {
		payload["evidenceHash"] = command.EvidenceHash
	}
	if command.Temperature != nil {
		payload["temperature"] = *command.Temperature
	}
	return payload
}

func (f *Fabric) evaluate(
	transactionName string,
	args []string,
	actor *model.User,
) ([]byte, error) {
	var result []byte
	err := f.withContract(actor, func(contract *client.Contract) error {
		content, err := contract.EvaluateTransaction(transactionName, args...)
		if err != nil {
			return err
		}
		result = content
		return nil
	})
	return result, err
}

func (f *Fabric) submit(
	transactionName string,
	args []string,
	actor model.User,
	transient map[string][]byte,
) (model.LedgerReceipt, error) {
	var receipt model.LedgerReceipt
	err := f.withContract(&actor, func(contract *client.Contract) error {
		options := []client.ProposalOption{client.WithArguments(args...)}
		if transient != nil {
			options = append(options, client.WithTransient(transient))
		}
		proposal, err := contract.NewProposal(transactionName, options...)
		if err != nil {
			return err
		}
		transaction, err := proposal.Endorse()
		if err != nil {
			return err
		}
		result := transaction.Result()
		commit, err := transaction.Submit()
		if err != nil {
			return err
		}
		status, err := commit.Status()
		if err != nil {
			return err
		}
		if !status.Successful {
			return apperror.WithDetails(502, "FABRIC_COMMIT_FAILED", "Fabric transaction was not committed", map[string]any{
				"transactionId":  status.TransactionID,
				"validationCode": status.Code,
			})
		}
		var shipment model.Shipment
		if err := decodeFabricJSON(result, transactionName, &shipment); err != nil {
			return err
		}
		receipt = model.LedgerReceipt{
			TransactionID: status.TransactionID, CommittedAt: shipment.UpdatedAt,
			LedgerMode: "fabric", Data: shipment,
		}
		return nil
	})
	return receipt, err
}

func (f *Fabric) withContract(actor *model.User, operation func(*client.Contract) error) error {
	resolved, err := f.resolveConnection(f.orgFor(actor))
	if err != nil {
		return err
	}
	gateway, connection, err := connectGateway(resolved)
	if err != nil {
		return mapFabricError(err)
	}
	defer gateway.Close()
	defer connection.Close()

	contract := gateway.GetNetwork(f.config.ChannelName).GetContract(f.config.ChaincodeName)
	if err := operation(contract); err != nil {
		return mapFabricError(err)
	}
	return nil
}

func (f *Fabric) orgFor(actor *model.User) config.OrgConfig {
	if actor != nil && actor.Role == "carrier" {
		return f.config.Org2
	}
	return f.config.Org1
}

func (f *Fabric) resolveConnection(org config.OrgConfig) (resolvedConnection, error) {
	if org.CertPath == "" || org.KeyPath == "" {
		return resolvedConnection{}, apperror.New(
			503, "FABRIC_IDENTITY_NOT_CONFIGURED",
			fmt.Sprintf("%s certificate and private-key paths are required", org.MSPID),
		)
	}

	endpoint := first(org.PeerEndpoint, f.config.PeerEndpoint)
	hostAlias := first(org.PeerHostAlias, f.config.PeerHostAlias)
	tlsPath := first(org.TLSCertPath, f.config.TLSCertPath)
	var tlsPEM []byte

	if f.profile != nil {
		profileBase := filepath.Dir(f.config.ConnectionProfilePath)
		for _, organization := range f.profile.Organizations {
			if organization.MSPID != org.MSPID || len(organization.Peers) == 0 {
				continue
			}
			peerName := organization.Peers[0]
			peer, ok := f.profile.Peers[peerName]
			if !ok {
				break
			}
			endpoint = first(endpoint, peer.URL)
			hostAlias = first(
				hostAlias,
				grpcOptionString(peer.GRPCOptions, "ssl-target-name-override"),
				grpcOptionString(peer.GRPCOptions, "grpc.ssl_target_name_override"),
				peerName,
			)
			if tlsPath == "" && peer.TLSCACerts.Path != "" {
				tlsPath = resolveFrom(profileBase, peer.TLSCACerts.Path)
			}
			switch value := peer.TLSCACerts.PEM.(type) {
			case string:
				tlsPEM = []byte(value)
			case []any:
				parts := make([]string, 0, len(value))
				for _, item := range value {
					if text, ok := item.(string); ok {
						parts = append(parts, text)
					}
				}
				tlsPEM = []byte(strings.Join(parts, "\n"))
			}
			break
		}
	}

	if endpoint == "" || hostAlias == "" || (tlsPath == "" && len(tlsPEM) == 0) {
		return resolvedConnection{}, apperror.New(
			503, "FABRIC_PEER_NOT_CONFIGURED",
			fmt.Sprintf("Peer endpoint, TLS CA, and host alias are required for %s", org.MSPID),
		)
	}
	if len(tlsPEM) == 0 {
		content, err := os.ReadFile(tlsPath)
		if err != nil {
			return resolvedConnection{}, err
		}
		tlsPEM = content
	}
	return resolvedConnection{
		MSPID: org.MSPID, CertPath: org.CertPath, KeyPath: org.KeyPath,
		Endpoint: cleanEndpoint(endpoint), HostAlias: hostAlias, TLSRootCertPEM: tlsPEM,
	}, nil
}

func connectGateway(resolved resolvedConnection) (*client.Gateway, *grpc.ClientConn, error) {
	certificatePEM, err := os.ReadFile(resolved.CertPath)
	if err != nil {
		return nil, nil, err
	}
	certificate, err := identity.CertificateFromPEM(certificatePEM)
	if err != nil {
		return nil, nil, err
	}
	id, err := identity.NewX509Identity(resolved.MSPID, certificate)
	if err != nil {
		return nil, nil, err
	}
	keyPath, err := resolvePrivateKeyPath(resolved.KeyPath)
	if err != nil {
		return nil, nil, err
	}
	privateKeyPEM, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, nil, err
	}
	privateKey, err := identity.PrivateKeyFromPEM(privateKeyPEM)
	if err != nil {
		return nil, nil, err
	}
	sign, err := identity.NewPrivateKeySign(privateKey)
	if err != nil {
		return nil, nil, err
	}

	pool := x509.NewCertPool()
	if ok := pool.AppendCertsFromPEM(resolved.TLSRootCertPEM); !ok {
		return nil, nil, errors.New("failed to add Fabric TLS certificate")
	}
	connection, err := grpc.NewClient(
		resolved.Endpoint,
		grpc.WithTransportCredentials(credentials.NewClientTLSFromCert(pool, resolved.HostAlias)),
	)
	if err != nil {
		return nil, nil, err
	}
	gateway, err := client.Connect(
		id,
		client.WithSign(sign),
		client.WithClientConnection(connection),
		client.WithEvaluateTimeout(5*time.Second),
		client.WithEndorseTimeout(15*time.Second),
		client.WithSubmitTimeout(5*time.Second),
		client.WithCommitStatusTimeout(time.Minute),
	)
	if err != nil {
		_ = connection.Close()
		return nil, nil, err
	}
	return gateway, connection, nil
}

func resolvePrivateKeyPath(path string) (string, error) {
	details, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if !details.IsDir() {
		return path, nil
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return "", err
	}
	candidates := make([]string, 0)
	for _, entry := range entries {
		name := entry.Name()
		if !entry.IsDir() && (strings.HasSuffix(name, "_sk") || strings.HasSuffix(name, ".pem")) {
			candidates = append(candidates, name)
		}
	}
	sort.Strings(candidates)
	if len(candidates) == 0 {
		return "", fmt.Errorf("no private key found in %s", path)
	}
	return filepath.Join(path, candidates[0]), nil
}

func mapFabricError(err error) error {
	var appError *apperror.Error
	if errors.As(err, &appError) {
		return err
	}
	message := err.Error()
	// The raw gateway error can embed peer endpoints and local file paths;
	// keep it in the server log and never send it to the client.
	log.Printf("fabric gateway error: %v", err)
	switch {
	case containsFold(message, "does not exist", "not found"):
		return apperror.New(404, "SHIPMENT_NOT_FOUND", "Shipment was not found on the Fabric ledger")
	case containsFold(message, "not authorized", "forbidden", "msp", "access denied"):
		return apperror.New(403, "FABRIC_FORBIDDEN", "Fabric rejected the submitting identity")
	case containsFold(message, "state", "expected", "already", "must be", "current status"):
		return apperror.New(409, "FABRIC_STATE_REJECTED", "Fabric rejected the shipment state transition")
	default:
		return apperror.New(502, "FABRIC_GATEWAY_ERROR", "Fabric Gateway request failed")
	}
}

func grpcOptionString(options map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := options[key].(string); ok {
			return value
		}
	}
	return ""
}

func decodeFabricJSON(content []byte, operation string, target any) error {
	if err := json.Unmarshal(content, target); err != nil {
		return apperror.New(502, "FABRIC_INVALID_RESPONSE", operation+" returned invalid JSON")
	}
	return nil
}

func cleanEndpoint(value string) string {
	value = strings.TrimPrefix(value, "grpc://")
	return strings.TrimPrefix(value, "grpcs://")
}

func resolveFrom(base, path string) string {
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(base, path)
}

func first(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func containsFold(value string, candidates ...string) bool {
	lower := strings.ToLower(value)
	for _, candidate := range candidates {
		if strings.Contains(lower, strings.ToLower(candidate)) {
			return true
		}
	}
	return false
}
