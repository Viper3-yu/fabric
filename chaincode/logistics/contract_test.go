package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"testing"
	"time"

	"github.com/Viper3-yu/fabric/chaincode/logistics/model"
	"github.com/golang/protobuf/proto"
	"github.com/hyperledger/fabric-chaincode-go/shimtest"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/hyperledger/fabric-protos-go/msp"
)

type contractHarness struct {
	t       *testing.T
	stub    *shimtest.MockStub
	creator map[string][]byte
}

func newHarness(t *testing.T) *contractHarness {
	t.Helper()
	chaincode, err := contractapi.NewChaincode(&LogisticsContract{})
	if err != nil {
		t.Fatalf("new chaincode: %v", err)
	}
	return &contractHarness{
		t: t, stub: shimtest.NewMockStub("logistics", chaincode),
		creator: make(map[string][]byte),
	}
}

func (h *contractHarness) invoke(
	mspID, txID string,
	transient map[string][]byte,
	args ...string,
) ([]byte, error) {
	h.t.Helper()
	creator, ok := h.creator[mspID]
	if !ok {
		var err error
		creator, err = serializedIdentity(mspID)
		if err != nil {
			h.t.Fatalf("create identity: %v", err)
		}
		h.creator[mspID] = creator
	}
	h.stub.Creator = creator
	h.stub.TransientMap = transient
	input := make([][]byte, len(args))
	for index, value := range args {
		input[index] = []byte(value)
	}
	response := h.stub.MockInvoke(txID, input)
	if response.Status != 200 {
		return nil, &invokeError{message: response.Message}
	}
	return response.Payload, nil
}

type invokeError struct {
	message string
}

func (e *invokeError) Error() string {
	return e.message
}

func TestLogisticsContractLifecycle(t *testing.T) {
	harness := newHarness(t)
	create := createPayload()
	payload, err := harness.invoke("Org1MSP", "tx-create", nil, "CreateShipment", create)
	if err != nil {
		t.Fatalf("create shipment: %v", err)
	}
	shipment := decodeShipmentTest(t, payload)
	if shipment.Status != model.StatusCreated || shipment.Events[0].TxID != "tx-create" {
		t.Fatalf("unexpected created shipment: %#v", shipment)
	}
	if indexed := string(harness.stub.State["TRACKING:JX202607200001"]); indexed != "shipment-001" {
		t.Fatalf("tracking index = %q", indexed)
	}

	_, err = harness.invoke(
		"Org2MSP", "tx-accept", nil, "AcceptShipment", shipment.ID,
		jsonText(map[string]any{
			"carrierId": "carrier-001", "carrierName": "迅达物流",
			"actorId": "carrier-001", "actorName": "迅达物流",
		}),
	)
	if err != nil {
		t.Fatalf("accept shipment: %v", err)
	}
	_, err = harness.invoke(
		"Org2MSP", "tx-pickup", nil, "PickupShipment", shipment.ID,
		jsonText(map[string]any{
			"actorId": "carrier-001", "actorName": "迅达物流", "location": "上海转运中心",
		}),
	)
	if err != nil {
		t.Fatalf("pickup shipment: %v", err)
	}
	payload, err = harness.invoke(
		"Org2MSP", "tx-checkpoint", nil, "AddCheckpoint", shipment.ID,
		jsonText(map[string]any{
			"actorId": "carrier-001", "actorName": "迅达物流",
			"location": "苏州温控仓", "description": "人工录入节点温度",
			"temperature": 9.1, "evidenceHash": sha256Text("temperature-proof"),
		}),
	)
	if err != nil {
		t.Fatalf("checkpoint: %v", err)
	}
	shipment = decodeShipmentTest(t, payload)
	if shipment.Status != model.StatusException || shipment.AnomalyCount != 1 {
		t.Fatalf("automatic exception not recorded: %#v", shipment)
	}
	if got := shipment.Events[len(shipment.Events)-2].Type; got != model.EventCheckpoint {
		t.Fatalf("penultimate event = %s", got)
	}
	if got := shipment.Events[len(shipment.Events)-1].Type; got != model.EventExceptionReported {
		t.Fatalf("last event = %s", got)
	}

	_, err = harness.invoke(
		"Org2MSP", "tx-resolve", nil, "ResolveException", shipment.ID,
		jsonText(map[string]any{
			"actorId": "carrier-001", "actorName": "迅达物流",
			"location": "苏州温控仓", "description": "更换冰盒，温度恢复",
		}),
	)
	if err != nil {
		t.Fatalf("resolve exception: %v", err)
	}
	_, err = harness.invoke(
		"Org2MSP", "tx-deliver", nil, "MarkDelivered", shipment.ID,
		jsonText(map[string]any{
			"actorId": "carrier-001", "actorName": "迅达物流",
			"location": "南京收货点", "evidenceHash": sha256Text("delivery-proof"),
		}),
	)
	if err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if _, err := harness.invoke(
		"Org1MSP", "tx-wrong", map[string][]byte{"deliveryCode": []byte("000000")},
		"ConfirmReceipt", shipment.ID,
		jsonText(map[string]string{"actorId": "receiver-001", "actorName": "李女士"}),
	); err == nil {
		t.Fatal("wrong delivery code was accepted")
	}
	payload, err = harness.invoke(
		"Org1MSP", "tx-receive", map[string][]byte{"deliveryCode": []byte("864209")},
		"ConfirmReceipt", shipment.ID,
		jsonText(map[string]string{"actorId": "receiver-001", "actorName": "李女士"}),
	)
	if err != nil {
		t.Fatalf("confirm receipt: %v", err)
	}
	shipment = decodeShipmentTest(t, payload)
	if shipment.Status != model.StatusReceived {
		t.Fatalf("status = %s", shipment.Status)
	}
	for index, event := range shipment.Events {
		if event.Sequence != index+1 {
			t.Fatalf("event %d has sequence %d", index, event.Sequence)
		}
	}
	if _, err := harness.invoke(
		"Org1MSP", "tx-replay", map[string][]byte{"deliveryCode": []byte("864209")},
		"ConfirmReceipt", shipment.ID,
		jsonText(map[string]string{"actorId": "receiver-001", "actorName": "李女士"}),
	); err == nil {
		t.Fatal("replayed receipt was accepted")
	}
}

func TestLogisticsContractAuthorizationAndQueries(t *testing.T) {
	harness := newHarness(t)
	if _, err := harness.invoke(
		"Org2MSP", "tx-denied", nil, "CreateShipment", createPayload(),
	); err == nil {
		t.Fatal("Org2 created a shipment")
	}
	if len(harness.stub.State) != 0 {
		t.Fatalf("denied transaction wrote state: %#v", harness.stub.State)
	}
	if _, err := harness.invoke(
		"Org1MSP", "tx-create", nil, "CreateShipment", createPayload(),
	); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := harness.invoke(
		"Org1MSP", "tx-duplicate", nil, "CreateShipment",
		jsonText(createInputMap("shipment-002", "JX202607200001")),
	); err == nil {
		t.Fatal("duplicate tracking number was accepted")
	}
	payload, err := harness.invoke(
		"ReadOnly", "tx-read", nil, "ReadShipment", "JX202607200001",
	)
	if err != nil {
		t.Fatalf("read by tracking: %v", err)
	}
	if shipment := decodeShipmentTest(t, payload); shipment.ID != "shipment-001" {
		t.Fatalf("resolved shipment = %s", shipment.ID)
	}
	payload, err = harness.invoke("ReadOnly", "tx-list", nil, "GetAllShipments")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var shipments []model.Shipment
	if err := json.Unmarshal(payload, &shipments); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(shipments) != 1 {
		t.Fatalf("shipment count = %d", len(shipments))
	}
}

func TestBuildHistoryEntriesSortsOldestFirst(t *testing.T) {
	shipment := func(id string, status string) []byte {
		content, _ := json.Marshal(model.Shipment{DocType: "shipment", ID: id, Status: status})
		return content
	}
	// Fabric's GetHistoryForKey returns results newest to oldest; feed the
	// records in that order to prove the output is oldest to newest.
	records := []historyRecord{
		{TxID: "tx-newest", Seconds: 3000, Value: shipment("shipment-001", "RECEIVED")},
		{TxID: "tx-middle", Seconds: 2000, Value: shipment("shipment-001", "PICKED_UP")},
		{TxID: "tx-oldest", Seconds: 1000, Value: shipment("shipment-001", "CREATED")},
	}
	history, err := buildHistoryEntries(records, "SHIPMENT:shipment-001")
	if err != nil {
		t.Fatalf("build history: %v", err)
	}
	if len(history) != 3 {
		t.Fatalf("history length = %d", len(history))
	}
	wantOrder := []string{"tx-oldest", "tx-middle", "tx-newest"}
	for index, want := range wantOrder {
		if history[index].TxID != want {
			t.Fatalf("entry %d txId = %s, want %s", index, history[index].TxID, want)
		}
		if history[index].Value == nil || history[index].Value.ID != "shipment-001" {
			t.Fatalf("entry %d value missing: %#v", index, history[index])
		}
	}
	if history[0].Timestamp != "1970-01-01T00:16:40.000Z" {
		t.Fatalf("first timestamp = %s", history[0].Timestamp)
	}

	// Same-second records must still order deterministically by TxID.
	sameSecond := []historyRecord{
		{TxID: "tx-b", Seconds: 10, Nanos: 500, Value: shipment("shipment-001", "B")},
		{TxID: "tx-a", Seconds: 10, Nanos: 500, Value: shipment("shipment-001", "A")},
	}
	ordered, err := buildHistoryEntries(sameSecond, "SHIPMENT:shipment-001")
	if err != nil {
		t.Fatalf("build same-second history: %v", err)
	}
	if ordered[0].TxID != "tx-a" || ordered[1].TxID != "tx-b" {
		t.Fatalf("same-second order = %s, %s", ordered[0].TxID, ordered[1].TxID)
	}
}

func createPayload() string {
	return jsonText(createInputMap("shipment-001", "JX202607200001"))
}

func createInputMap(id, tracking string) map[string]any {
	return map[string]any{
		"id": id, "trackingNumber": tracking,
		"shipperId": "shipper-001", "shipperName": "华东食品有限公司",
		"origin": map[string]any{
			"province": "上海市", "city": "上海市", "district": "浦东新区",
			"detail": "世纪大道 100 号", "contactName": "张先生",
			"contactPhoneMasked": "138****1000",
		},
		"destination": map[string]any{
			"province": "江苏省", "city": "南京市", "district": "玄武区",
			"detail": "中山路 20 号", "contactName": "李女士",
			"contactPhoneMasked": "139****2000",
		},
		"goods": map[string]any{
			"name": "冷藏疫苗", "category": "医药冷链",
			"quantity": 10, "weightKg": 25.5,
		},
		"recipientMasked":      "李** · 139****2000",
		"expectedDeliveryDate": "2026-07-22",
		"temperatureRange":     map[string]any{"min": 2, "max": 8, "unit": "C"},
		"deliveryCodeHash":     sha256Text("864209"),
		"documentHash":         sha256Text("shipping-document"),
		"location":             "上海市 · 世纪大道 100 号",
		"description":          "发货方创建运单",
	}
}

func serializedIdentity(mspID string) ([]byte, error) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "test-user"},
		Issuer:       pkix.Name{CommonName: "test-ca"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
	}
	certificate, err := x509.CreateCertificate(
		rand.Reader, template, template, &privateKey.PublicKey, privateKey,
	)
	if err != nil {
		return nil, err
	}
	identity := &msp.SerializedIdentity{
		Mspid: mspID,
		IdBytes: pem.EncodeToMemory(&pem.Block{
			Type: "CERTIFICATE", Bytes: certificate,
		}),
	}
	return proto.Marshal(identity)
}

func decodeShipmentTest(t *testing.T, payload []byte) model.Shipment {
	t.Helper()
	var shipment model.Shipment
	if err := json.Unmarshal(payload, &shipment); err != nil {
		t.Fatalf("decode shipment: %v\n%s", err, payload)
	}
	return shipment
}

func jsonText(value any) string {
	content, _ := json.Marshal(value)
	return string(content)
}

func sha256Text(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
