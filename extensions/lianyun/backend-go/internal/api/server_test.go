package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"lianyun-backend/internal/ledger"
	"lianyun-backend/internal/service"
)

func TestHealthReportsSelectedMode(t *testing.T) {
	router := New(service.NewControlTowerService(ledger.NewMock()), "fabric").Router()
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d", response.Code)
	}
	var body struct {
		OK   bool   `json:"ok"`
		Mode string `json:"mode"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.OK || body.Mode != "fabric" {
		t.Fatalf("unexpected body: %+v", body)
	}
}

func TestBilateralHandoverEndpoints(t *testing.T) {
	router := New(service.NewControlTowerService(ledger.NewMock()), "fabric").Router()
	initiate := httptest.NewRecorder()
	initiateBody := []byte(`{"handoverId":"HO-TEST-001","fromHub":"HZ-HUB-01","toHub":"WH-HUB-01","carrierOrg":"Org2MSP"}`)
	request := httptest.NewRequest(http.MethodPost, "/api/shipments/YT20260001/handovers", bytes.NewReader(initiateBody))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(initiate, request)
	if initiate.Code != http.StatusOK {
		t.Fatalf("initiate status=%d body=%s", initiate.Code, initiate.Body.String())
	}

	confirm := httptest.NewRecorder()
	router.ServeHTTP(confirm, httptest.NewRequest(http.MethodPost, "/api/handovers/HO-TEST-001/confirm", nil))
	if confirm.Code != http.StatusOK {
		t.Fatalf("confirm status=%d body=%s", confirm.Code, confirm.Body.String())
	}
	var body struct {
		OK   bool `json:"ok"`
		Data struct {
			Status     string `json:"status"`
			ConfirmOrg string `json:"confirmOrg"`
		} `json:"data"`
	}
	if err := json.Unmarshal(confirm.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.OK || body.Data.Status != "CONFIRMED" || body.Data.ConfirmOrg != "Org2MSP" {
		t.Fatalf("unexpected body: %+v", body)
	}
}

func TestControlTowerReturnsDemoShipment(t *testing.T) {
	router := New(service.NewControlTowerService(ledger.NewMock()), "mock").Router()
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/shipments/YT20260001/control-tower", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var body struct {
		OK   bool `json:"ok"`
		Data struct {
			Segments []any `json:"segments"`
			Risks    []any `json:"risks"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.OK || len(body.Data.Segments) != 4 || len(body.Data.Risks) == 0 {
		t.Fatalf("unexpected body: %+v", body)
	}
}
