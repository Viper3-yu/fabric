package api

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"tower-api/internal/ledger"
	"tower-api/internal/service"
)

const testSecret = "test-secret"

// mintSessionToken produces a token in the exact apps/api format
// (HS256, claims sub/role/iat/exp) so the router accepts it as a session.
func mintSessionToken(t *testing.T, sub, role string) string {
	t.Helper()
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload, err := json.Marshal(map[string]any{
		"sub": sub, "role": role,
		"iat": time.Now().UTC().Unix(), "exp": time.Now().UTC().Add(time.Hour).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	unsigned := header + "." + encodedPayload
	mac := hmac.New(sha256.New, []byte(testSecret))
	_, _ = mac.Write([]byte(unsigned))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return unsigned + "." + signature
}

func TestHealthReportsSelectedMode(t *testing.T) {
	router := New(service.NewControlTowerService(ledger.NewMock()), "fabric", "1", testSecret).Router()
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d", response.Code)
	}
	var body struct {
		OK   bool   `json:"ok"`
		Mode string `json:"mode"`
		Org  string `json:"org"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.OK || body.Mode != "fabric" || body.Org != "Org1MSP" {
		t.Fatalf("unexpected body: %+v", body)
	}
}

func TestMissingShipmentHasReadableError(t *testing.T) {
	router := New(service.NewControlTowerService(ledger.NewMock()), "mock", "1", testSecret).Router()
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/shipments/missing/control-tower", nil))
	if response.Code != http.StatusNotFound || !bytes.Contains(response.Body.Bytes(), []byte("未找到该运单")) {
		t.Fatalf("unexpected error: %s", response.Body.String())
	}
}

func TestWriteRequiresSession(t *testing.T) {
	router := New(service.NewControlTowerService(ledger.NewMock()), "mock", "1", testSecret).Router()
	response := httptest.NewRecorder()
	body := []byte(`{"handoverId":"HO-X","fromHub":"A","toHub":"B","carrierOrg":"Org2MSP"}`)
	request := httptest.NewRequest(http.MethodPost, "/api/shipments/YT20260001/handovers", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated write must be 401, got %d", response.Code)
	}
}

func TestInitiateRestrictedToShipperOnOrg1(t *testing.T) {
	router := New(service.NewControlTowerService(ledger.NewMock()), "mock", "1", testSecret).Router()
	post := func(token string) *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		body := []byte(`{"handoverId":"HO-R-1","fromHub":"HZ-WH-01","toHub":"HZ-HUB-01","carrierOrg":"Org2MSP"}`)
		request := httptest.NewRequest(http.MethodPost, "/api/shipments/YT20260001/handovers", bytes.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		if token != "" {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		router.ServeHTTP(response, request)
		return response
	}
	if code := post(mintSessionToken(t, "carrier-demo", "carrier")).Code; code != http.StatusForbidden {
		t.Fatalf("carrier initiate on Org1 must be 403, got %d", code)
	}
	if code := post("").Code; code != http.StatusUnauthorized {
		t.Fatalf("anonymous initiate must be 401, got %d", code)
	}
	if code := post(mintSessionToken(t, "shipper-demo", "shipper")).Code; code != http.StatusOK {
		t.Fatalf("shipper initiate must be 200, got %d", code)
	}
}

func TestBilateralHandoverAcrossOrgServices(t *testing.T) {
	// Both org instances share one ledger, like two processes on the same
	// Fabric network.
	sharedLedger := ledger.NewMock()
	org1 := New(service.NewControlTowerService(sharedLedger), "mock", "1", testSecret).Router()
	org2 := New(service.NewControlTowerService(sharedLedger), "mock", "2", testSecret).Router()

	initiate := httptest.NewRecorder()
	initiateBody := []byte(`{"handoverId":"HO-TEST-001","fromHub":"HZ-HUB-01","toHub":"WH-HUB-01","carrierOrg":"Org2MSP"}`)
	request := httptest.NewRequest(http.MethodPost, "/api/shipments/YT20260001/handovers", bytes.NewReader(initiateBody))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+mintSessionToken(t, "shipper-demo", "shipper"))
	org1.ServeHTTP(initiate, request)
	if initiate.Code != http.StatusOK {
		t.Fatalf("initiate status=%d body=%s", initiate.Code, initiate.Body.String())
	}

	// The shipper cannot confirm through the Org2 service: role mismatch.
	confirmAsShipper := httptest.NewRecorder()
	confirmRequest := httptest.NewRequest(http.MethodPost, "/api/handovers/HO-TEST-001/confirm", nil)
	confirmRequest.Header.Set("Authorization", "Bearer "+mintSessionToken(t, "shipper-demo", "shipper"))
	org2.ServeHTTP(confirmAsShipper, confirmRequest)
	if confirmAsShipper.Code != http.StatusForbidden {
		t.Fatalf("shipper confirm must be 403, got %d", confirmAsShipper.Code)
	}

	confirm := httptest.NewRecorder()
	confirmRequest = httptest.NewRequest(http.MethodPost, "/api/handovers/HO-TEST-001/confirm", nil)
	confirmRequest.Header.Set("Authorization", "Bearer "+mintSessionToken(t, "carrier-demo", "carrier"))
	org2.ServeHTTP(confirm, confirmRequest)
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

	repeat := httptest.NewRecorder()
	repeatRequest := httptest.NewRequest(http.MethodPost, "/api/handovers/HO-TEST-001/confirm", nil)
	repeatRequest.Header.Set("Authorization", "Bearer "+mintSessionToken(t, "carrier-demo", "carrier"))
	org2.ServeHTTP(repeat, repeatRequest)
	if repeat.Code != http.StatusBadRequest {
		t.Fatalf("double confirm must be 400, got %d", repeat.Code)
	}
}

func TestControlTowerDerivesRouteFromRealEndpoints(t *testing.T) {
	router := New(service.NewControlTowerService(ledger.NewMock()), "mock", "1", testSecret).Router()
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/shipments/YT20260001/control-tower", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var body struct {
		OK   bool `json:"ok"`
		Data struct {
			DataSource string `json:"dataSource"`
			Segments   []struct {
				FromHub struct {
					City string `json:"city"`
				} `json:"fromHub"`
				ToHub struct {
					City string `json:"city"`
				} `json:"toHub"`
			} `json:"segments"`
			Temperature []struct {
				Value float64 `json:"value"`
			} `json:"temperature"`
			Risks []any `json:"risks"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.OK || body.Data.DataSource != "demo" {
		t.Fatalf("unexpected body: %+v", body)
	}
	// The mock shipment runs 杭州 -> 北京: the derived route must match it
	// instead of a fixed demo corridor.
	segments := body.Data.Segments
	if len(segments) != 2 ||
		segments[0].FromHub.City != "杭州" || segments[len(segments)-1].ToHub.City != "北京" {
		t.Fatalf("derived route does not match shipment endpoints: %+v", segments)
	}
	// Mock events carry two checkpoint temperatures; the chart shows real
	// event values, not an invented series.
	if len(body.Data.Temperature) != 2 {
		t.Fatalf("expected 2 event temperatures, got %+v", body.Data.Temperature)
	}
	if len(body.Data.Risks) == 0 {
		t.Fatalf("expected risks from the exception event")
	}
}
