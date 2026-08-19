package ledger

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/rand"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Viper3-yu/fabric/apps/api/internal/config"
	"github.com/Viper3-yu/fabric/apps/api/internal/users"
	"github.com/Viper3-yu/fabric/chaincode/logistics/model"
)

// TestFabricClosedLoopIntegration drives the real create -> accept -> pickup
// -> checkpoint -> deliver -> receive loop against the local Fabric test
// network and verifies the chain state, events and history afterwards.
//
// It is skipped in the normal go test ./... run: it needs the network up
// (pnpm fabric:up) plus the Fabric credentials and application secrets in
// the environment. scripts/test-fabric.ps1 wires all of that up and runs
// it via pnpm test:fabric; CI without a Docker network stays green because
// of the skip.
func TestFabricClosedLoopIntegration(t *testing.T) {
	if os.Getenv("FABRIC_INTEGRATION_TEST") != "1" {
		t.Skip("set FABRIC_INTEGRATION_TEST=1 with the Fabric test network up to run the integration loop")
	}
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	fabric, err := NewFabric(cfg.Fabric)
	if err != nil {
		t.Fatalf("new fabric: %v", err)
	}
	defer fabric.Close()

	health := fabric.Health(context.Background())
	if health.Status != "ok" {
		t.Fatalf("fabric health = %q: %s", health.Status, health.Details)
	}

	shipper := users.ByUsername["shipper"].User
	carrier := users.ByUsername["carrier"].User
	receiver := users.ByUsername["receiver"].User

	const deliveryCode = "246810"
	codeHash := sha256.Sum256([]byte(deliveryCode))
	documentHash := sha256.Sum256([]byte("fabric-integration-document"))
	suffix := fmt.Sprintf("%08d", rand.Int63n(100000000))
	tracking := "JX" + time.Now().UTC().Format("20060102") + suffix

	created, err := fabric.CreateShipment(context.Background(), CreateShipmentCommand{
		ID:             "shipment-integration-" + suffix,
		TrackingNumber: tracking,
		Origin: model.Address{
			Province: "上海市", City: "上海市", District: "浦东新区",
			Detail: "张江物流园集成测试仓", ContactName: "集成发货人", ContactPhoneMasked: "138****0001",
		},
		Destination: model.Address{
			Province: "江苏省", City: "南京市", District: "玄武区",
			Detail: "珠江路集成测试点", ContactName: "集成收货人", ContactPhoneMasked: "139****0002",
		},
		Goods: model.GoodsInfo{
			Name: "集成测试货物", Category: "冷链", Quantity: 1, WeightKG: 2.5,
		},
		RecipientMasked:      "集** · 139****0002",
		RecipientID:          receiver.ID,
		ExpectedDeliveryDate: "2026-12-31",
		TemperatureRange:     &model.TemperatureRange{Min: 2, Max: 8, Unit: "C"},
		DeliveryCodeHash:     hex.EncodeToString(codeHash[:]),
		DocumentHash:         hex.EncodeToString(documentHash[:]),
	}, shipper)
	if err != nil {
		t.Fatalf("create shipment: %v", err)
	}
	if strings.HasPrefix(created.TransactionID, "demo-") || created.TransactionID == "" {
		t.Fatalf("create receipt must carry a real Fabric transaction id: %#v", created.TransactionID)
	}
	id := created.Data.ID

	steps := []struct {
		name   string
		actor  model.User
		run    func() (model.LedgerReceipt, error)
		status string
		events int
	}{
		{
			"accept", carrier,
			func() (model.LedgerReceipt, error) {
				return fabric.AcceptShipment(context.Background(), id, ActionCommand{Location: "上海运营中心"}, carrier)
			},
			model.StatusAccepted, 2,
		},
		{
			"pickup", carrier,
			func() (model.LedgerReceipt, error) {
				return fabric.PickupShipment(context.Background(), id, ActionCommand{Location: "上海张江物流园"}, carrier)
			},
			model.StatusPickedUp, 3,
		},
		{
			"checkpoint", carrier,
			func() (model.LedgerReceipt, error) {
				return fabric.AddCheckpoint(context.Background(), id, ActionCommand{
					Location: "昆山中转中心", Description: "集成测试干线中转",
				}, carrier)
			},
			model.StatusInTransit, 4,
		},
		{
			"deliver", carrier,
			func() (model.LedgerReceipt, error) {
				evidence := sha256.Sum256([]byte("integration-delivery-evidence"))
				return fabric.MarkDelivered(context.Background(), id, ActionCommand{
					Location: "南京市玄武区", Description: "集成测试已送达",
					EvidenceHash: hex.EncodeToString(evidence[:]),
				}, carrier)
			},
			model.StatusDelivered, 5,
		},
	}
	for _, step := range steps {
		receipt, err := step.run()
		if err != nil {
			t.Fatalf("%s: %v", step.name, err)
		}
		if receipt.TransactionID == "" || strings.HasPrefix(receipt.TransactionID, "demo-") {
			t.Fatalf("%s receipt must carry a real Fabric transaction id: %#v", step.name, receipt.TransactionID)
		}
		if receipt.Data.Status != step.status || len(receipt.Data.Events) != step.events {
			t.Fatalf(
				"%s receipt status/events = %s/%d, want %s/%d",
				step.name, receipt.Data.Status, len(receipt.Data.Events), step.status, step.events,
			)
		}
	}

	confirmed, err := fabric.ConfirmReceipt(context.Background(), id, ConfirmCommand{
		ActionCommand: ActionCommand{Location: "南京市玄武区", Description: "集成测试确认收货"},
		DeliveryCode:  deliveryCode,
	}, receiver)
	if err != nil {
		t.Fatalf("confirm receipt: %v", err)
	}
	if confirmed.Data.Status != model.StatusReceived || len(confirmed.Data.Events) != 6 {
		t.Fatalf("confirm receipt status/events = %s/%d, want %s/6",
			confirmed.Data.Status, len(confirmed.Data.Events), model.StatusReceived)
	}

	read, err := fabric.ReadShipment(context.Background(), id, nil)
	if err != nil {
		t.Fatalf("read shipment: %v", err)
	}
	if read.Status != model.StatusReceived || read.TrackingNumber != tracking {
		t.Fatalf("read shipment = %#v", read)
	}
	history, err := fabric.GetShipmentHistory(context.Background(), id, nil)
	if err != nil {
		t.Fatalf("shipment history: %v", err)
	}
	if len(history) != 6 {
		t.Fatalf("history length = %d, want 6", len(history))
	}
	all, err := fabric.GetAllShipments(context.Background(), nil)
	if err != nil {
		t.Fatalf("get all shipments: %v", err)
	}
	found := false
	for _, shipment := range all {
		if shipment.ID == id {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("created shipment missing from GetAllShipments")
	}
	t.Logf("closed loop committed: shipment=%s tracking=%s firstTx=%s lastTx=%s",
		id, tracking, created.TransactionID, confirmed.TransactionID)
}
