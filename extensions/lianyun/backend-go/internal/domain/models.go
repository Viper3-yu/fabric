package domain

type Hub struct {
	Code      string  `json:"code"`
	Name      string  `json:"name"`
	City      string  `json:"city"`
	Longitude float64 `json:"longitude"`
	Latitude  float64 `json:"latitude"`
	Type      string  `json:"type"`
}

type MapPoint struct {
	Longitude float64 `json:"longitude"`
	Latitude  float64 `json:"latitude"`
	At        string  `json:"at"`
	Speed     float64 `json:"speed,omitempty"`
}

type RouteSegment struct {
	ID               string     `json:"id"`
	Sequence         int        `json:"sequence"`
	FromHub          Hub        `json:"fromHub"`
	ToHub            Hub        `json:"toHub"`
	PlannedDeparture string     `json:"plannedDeparture"`
	PlannedArrival   string     `json:"plannedArrival"`
	ActualDeparture  string     `json:"actualDeparture,omitempty"`
	ActualArrival    string     `json:"actualArrival,omitempty"`
	CarrierOrg       string     `json:"carrierOrg"`
	Status           string     `json:"status"`
	Polyline         []MapPoint `json:"polyline"`
}

type TrackingEvent struct {
	ID           string `json:"id"`
	Type         string `json:"type"`
	HubCode      string `json:"hubCode"`
	HubName      string `json:"hubName"`
	ActorOrg     string `json:"actorOrg"`
	ActorName    string `json:"actorName"`
	Remark       string `json:"remark"`
	Severity     string `json:"severity,omitempty"`
	EvidenceHash string `json:"evidenceHash,omitempty"`
	At           string `json:"at"`
	TxID         string `json:"txId"`
}

type Parcel struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	UnitID string `json:"unitId,omitempty"`
}

type Handover struct {
	DocType      string `json:"docType"`
	HandoverID   string `json:"handoverId"`
	ShipmentID   string `json:"shipmentId"`
	FromHub      string `json:"fromHub"`
	ToHub        string `json:"toHub"`
	CarrierOrg   string `json:"carrierOrg"`
	Status       string `json:"status"`
	InitiatorOrg string `json:"initiatorOrg"`
	ConfirmOrg   string `json:"confirmOrg,omitempty"`
	CreatedAt    string `json:"createdAt"`
	ConfirmedAt  string `json:"confirmedAt,omitempty"`
}

type Shipment struct {
	ID          string          `json:"id"`
	Origin      string          `json:"origin"`
	Destination string          `json:"destination"`
	Status      string          `json:"status"`
	OwnerOrg    string          `json:"ownerOrg"`
	CarrierOrg  string          `json:"carrierOrg"`
	Parcels     []Parcel        `json:"parcels"`
	Events      []TrackingEvent `json:"events"`
}

type Risk struct {
	ID             string `json:"id"`
	Type           string `json:"type"`
	Level          string `json:"level"`
	Title          string `json:"title"`
	Description    string `json:"description"`
	SegmentID      string `json:"segmentId,omitempty"`
	HubCode        string `json:"hubCode,omitempty"`
	RelatedEventID string `json:"relatedEventId,omitempty"`
	Status         string `json:"status"`
}

type TemperatureReading struct {
	At       string  `json:"at"`
	Value    float64 `json:"value"`
	Humidity float64 `json:"humidity"`
}

type ControlTower struct {
	Shipment         Shipment             `json:"shipment"`
	Hubs             []Hub                `json:"hubs"`
	Segments         []RouteSegment       `json:"segments"`
	GPS              []MapPoint           `json:"gps"`
	Risks            []Risk               `json:"risks"`
	Temperature      []TemperatureReading `json:"temperature"`
	TemperatureRange struct {
		Min float64 `json:"min"`
		Max float64 `json:"max"`
	} `json:"temperatureRange"`
}
