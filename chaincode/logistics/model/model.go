package model

const (
	StatusCreated   = "CREATED"
	StatusAccepted  = "ACCEPTED"
	StatusPickedUp  = "PICKED_UP"
	StatusInTransit = "IN_TRANSIT"
	StatusException = "EXCEPTION"
	StatusDelivered = "DELIVERED"
	StatusReceived  = "RECEIVED"
	StatusCancelled = "CANCELLED"
)

var ShipmentStatuses = []string{
	StatusCreated,
	StatusAccepted,
	StatusPickedUp,
	StatusInTransit,
	StatusException,
	StatusDelivered,
	StatusReceived,
	StatusCancelled,
}

const (
	EventCreated           = "CREATED"
	EventAccepted          = "ACCEPTED"
	EventPickedUp          = "PICKED_UP"
	EventCheckpoint        = "CHECKPOINT"
	EventExceptionReported = "EXCEPTION_REPORTED"
	EventExceptionResolved = "EXCEPTION_RESOLVED"
	EventDelivered         = "DELIVERED"
	EventReceived          = "RECEIVED"
	EventCancelled         = "CANCELLED"
)

type User struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	MSPID       string `json:"mspId"`
}

type Address struct {
	Province           string `json:"province"`
	City               string `json:"city"`
	District           string `json:"district,omitempty"`
	Detail             string `json:"detail"`
	ContactName        string `json:"contactName"`
	ContactPhoneMasked string `json:"contactPhoneMasked"`
}

type GoodsInfo struct {
	Name        string  `json:"name"`
	Category    string  `json:"category"`
	Quantity    int     `json:"quantity"`
	WeightKG    float64 `json:"weightKg"`
	Description string  `json:"description,omitempty"`
}

type TemperatureRange struct {
	Min  float64 `json:"min"`
	Max  float64 `json:"max"`
	Unit string  `json:"unit"`
}

type ShipmentEvent struct {
	Sequence     int      `json:"sequence"`
	Type         string   `json:"type"`
	Location     string   `json:"location"`
	Description  string   `json:"description"`
	ActorID      string   `json:"actorId"`
	ActorName    string   `json:"actorName"`
	MSPID        string   `json:"mspId"`
	TxID         string   `json:"txId"`
	Timestamp    string   `json:"timestamp"`
	Temperature  *float64 `json:"temperature,omitempty"`
	EvidenceHash string   `json:"evidenceHash,omitempty"`
}

type Shipment struct {
	DocType        string `json:"docType"`
	ID             string `json:"id"`
	TrackingNumber string `json:"trackingNumber"`
	Status         string `json:"status"`
	ShipperID      string `json:"shipperId"`
	ShipperName    string `json:"shipperName"`
	CarrierID      string `json:"carrierId,omitempty"`
	CarrierName    string `json:"carrierName,omitempty"`
	// RecipientID binds the shipment to the receiver account allowed to view
	// and confirm it. Empty on shipments recorded before this field existed.
	RecipientID          string            `json:"recipientId,omitempty"`
	Origin               Address           `json:"origin"`
	Destination          Address           `json:"destination"`
	Goods                GoodsInfo         `json:"goods"`
	RecipientMasked      string            `json:"recipientMasked"`
	ExpectedDeliveryDate string            `json:"expectedDeliveryDate"`
	TemperatureRange     *TemperatureRange `json:"temperatureRange,omitempty"`
	DeliveryCodeHash     string            `json:"deliveryCodeHash"`
	DocumentHash         string            `json:"documentHash,omitempty"`
	Events               []ShipmentEvent   `json:"events"`
	AnomalyCount         int               `json:"anomalyCount"`
	LastLocation         string            `json:"lastLocation"`
	CreatedAt            string            `json:"createdAt"`
	UpdatedAt            string            `json:"updatedAt"`
}

type ShipmentHistoryEntry struct {
	TxID      string    `json:"txId"`
	Timestamp string    `json:"timestamp"`
	IsDelete  bool      `json:"isDelete"`
	Value     *Shipment `json:"value"`
}

type ChaincodeShipmentEvent struct {
	EventName      string          `json:"eventName"`
	Action         string          `json:"action"`
	ShipmentID     string          `json:"shipmentId"`
	TrackingNumber string          `json:"trackingNumber"`
	Status         string          `json:"status"`
	TxID           string          `json:"txId"`
	Timestamp      string          `json:"timestamp"`
	MSPID          string          `json:"mspId"`
	Events         []ShipmentEvent `json:"events"`
}

type LedgerReceipt struct {
	TransactionID string   `json:"transactionId"`
	CommittedAt   string   `json:"committedAt"`
	LedgerMode    string   `json:"ledgerMode"`
	Data          Shipment `json:"data"`
}
