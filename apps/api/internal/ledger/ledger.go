package ledger

import (
	"context"

	"github.com/Viper3-yu/fabric/chaincode/logistics/model"
)

type CreateShipmentCommand struct {
	ID                   string
	TrackingNumber       string
	Origin               model.Address
	Destination          model.Address
	Goods                model.GoodsInfo
	RecipientMasked      string
	ExpectedDeliveryDate string
	TemperatureRange     *model.TemperatureRange
	DeliveryCodeHash     string
	DocumentHash         string
}

type ActionCommand struct {
	Location     string   `json:"location,omitempty"`
	Description  string   `json:"description,omitempty"`
	EvidenceHash string   `json:"evidenceHash,omitempty"`
	Temperature  *float64 `json:"temperature,omitempty"`
}

type ConfirmCommand struct {
	ActionCommand
	DeliveryCode string `json:"deliveryCode"`
}

type Health struct {
	Mode      string `json:"mode"`
	Status    string `json:"status"`
	Network   string `json:"network"`
	Channel   string `json:"channel,omitempty"`
	Chaincode string `json:"chaincode,omitempty"`
	Details   string `json:"details,omitempty"`
}

type Ledger interface {
	Mode() string
	Health(context.Context) Health
	Close() error
	GetAllShipments(context.Context, *model.User) ([]model.Shipment, error)
	ReadShipment(context.Context, string, *model.User) (model.Shipment, error)
	ReadShipmentByTracking(context.Context, string, *model.User) (model.Shipment, error)
	GetShipmentHistory(context.Context, string, *model.User) ([]model.ShipmentHistoryEntry, error)
	CreateShipment(context.Context, CreateShipmentCommand, model.User) (model.LedgerReceipt, error)
	AcceptShipment(context.Context, string, ActionCommand, model.User) (model.LedgerReceipt, error)
	PickupShipment(context.Context, string, ActionCommand, model.User) (model.LedgerReceipt, error)
	AddCheckpoint(context.Context, string, ActionCommand, model.User) (model.LedgerReceipt, error)
	ReportException(context.Context, string, ActionCommand, model.User) (model.LedgerReceipt, error)
	ResolveException(context.Context, string, ActionCommand, model.User) (model.LedgerReceipt, error)
	MarkDelivered(context.Context, string, ActionCommand, model.User) (model.LedgerReceipt, error)
	ConfirmReceipt(context.Context, string, ConfirmCommand, model.User) (model.LedgerReceipt, error)
	CancelShipment(context.Context, string, ActionCommand, model.User) (model.LedgerReceipt, error)
}
