package ledger

import "lianyun-backend/internal/domain"

type Client interface {
	ReadShipment(string) (domain.Shipment, error)
	QueryTrace(string) ([]domain.TrackingEvent, error)
	AppendEvent(string, domain.TrackingEvent) (domain.TrackingEvent, error)
	InitiateHandover(shipmentID, handoverID, fromHub, toHub, carrierOrg string) (domain.Handover, error)
	ConfirmHandover(handoverID string) (domain.Handover, error)
}
