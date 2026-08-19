package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Viper3-yu/fabric/apps/api/internal/config"
	"github.com/Viper3-yu/fabric/apps/api/internal/ledger/fake"
	"github.com/Viper3-yu/fabric/apps/api/internal/users"
	"github.com/Viper3-yu/fabric/chaincode/logistics/model"
)

type testAPI struct {
	t       *testing.T
	server  *httptest.Server
	path    string
	headers http.Header
}

func newTestAPI(t *testing.T) *testAPI {
	t.Helper()
	return newTestAPIWithLimit(t, 0)
}

func newTestAPIWithLimit(t *testing.T, publicLimit int) *testAPI {
	t.Helper()
	users.Configure(map[string]string{
		"shipper": "shipper123", "carrier": "carrier123",
		"receiver": "receiver123", "auditor": "auditor123",
	}, nil)
	path := filepath.Join(t.TempDir(), "ledger.json")
	store, err := fake.New(path)
	if err != nil {
		t.Fatalf("new fake ledger: %v", err)
	}
	cfg := config.Config{
		Environment: "test",
		JWTSecret:   "closed-loop-test-secret-long-enough", JWTExpiresIn: 8 * time.Hour,
		CORSOrigins:              []string{"http://localhost:5173"},
		PublicRateLimitPerMinute: publicLimit,
	}
	return &testAPI{
		t: t, server: httptest.NewServer(New(cfg, store)), path: path,
		headers: make(http.Header),
	}
}

func (api *testAPI) close() {
	api.server.Close()
}

func (api *testAPI) request(
	method, path, token string,
	body any,
	expectedStatus int,
) map[string]any {
	api.t.Helper()
	var content []byte
	if body != nil {
		content, _ = json.Marshal(body)
	}
	request, err := http.NewRequest(method, api.server.URL+path, bytes.NewReader(content))
	if err != nil {
		api.t.Fatal(err)
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := api.server.Client().Do(request)
	if err != nil {
		api.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer response.Body.Close()
	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		api.t.Fatalf("decode %s %s: %v", method, path, err)
	}
	if response.StatusCode != expectedStatus {
		api.t.Fatalf(
			"%s %s status %d, want %d: %#v",
			method, path, response.StatusCode, expectedStatus, payload,
		)
	}
	return payload
}

func (api *testAPI) login(username string) string {
	api.t.Helper()
	payload := api.request(http.MethodPost, "/api/auth/login", "", map[string]string{
		"username": username, "password": username + "123",
	}, http.StatusOK)
	return payload["data"].(map[string]any)["token"].(string)
}

func TestClosedLoop(t *testing.T) {
	api := newTestAPI(t)
	defer api.close()
	shipper := api.login("shipper")
	carrier := api.login("carrier")
	receiver := api.login("receiver")

	health := api.request(http.MethodGet, "/api/health", "", nil, http.StatusOK)
	if health["data"].(map[string]any)["ledger"].(map[string]any)["mode"] != "fabric" {
		t.Fatalf("health = %#v", health)
	}
	created := api.request(http.MethodPost, "/api/shipments", shipper, map[string]any{
		"origin": map[string]any{
			"province": "上海市", "city": "上海市", "district": "浦东新区",
			"detail": "张江物流园 8 号仓", "contactName": "张发货",
			"contactPhone": "13800001234",
		},
		"destination": map[string]any{
			"province": "江苏省", "city": "南京市", "district": "玄武区",
			"detail": "珠江路 100 号", "contactName": "李收货",
			"contactPhone": "13900005678",
		},
		"goods": map[string]any{
			"name": "冷链试剂", "category": "医药", "quantity": 2, "weightKg": 3.6,
		},
		"expectedDeliveryDate": "2026-07-25",
		"temperatureRange":     map[string]any{"min": 2, "max": 8, "unit": "C"},
		"documentHash":         strings.Repeat("a", 64),
	}, http.StatusCreated)
	createData := created["data"].(map[string]any)
	shipment := createData["data"].(map[string]any)
	id := shipment["id"].(string)
	tracking := shipment["trackingNumber"].(string)
	deliveryCode := createData["deliveryCode"].(string)
	if !strings.HasPrefix(createData["transactionId"].(string), "fake-") || len(deliveryCode) != 6 {
		t.Fatalf("create receipt = %#v", createData)
	}

	actions := []struct {
		name   string
		token  string
		body   map[string]any
		status string
	}{
		{"accept", carrier, map[string]any{"location": "上海运营中心"}, "ACCEPTED"},
		{"pickup", carrier, map[string]any{"location": "上海张江物流园"}, "PICKED_UP"},
		{"checkpoint", carrier, map[string]any{
			"location": "昆山中转站", "description": "冷链运输正常", "temperature": 5.1,
		}, "IN_TRANSIT"},
		{"exception", carrier, map[string]any{
			"location": "昆山中转站", "description": "车辆临时检修",
			"evidenceHash": strings.Repeat("b", 64),
		}, "EXCEPTION"},
		{"resolve", carrier, map[string]any{
			"location": "昆山中转站", "description": "备用车辆完成换装",
		}, "IN_TRANSIT"},
		{"checkpoint", carrier, map[string]any{
			"location": "南京配送中心", "description": "进入末端配送", "temperature": 4.8,
		}, "IN_TRANSIT"},
		{"deliver", carrier, map[string]any{
			"location": "南京市玄武区", "description": "已送达指定地点",
			"evidenceHash": strings.Repeat("c", 64),
		}, "DELIVERED"},
	}
	for _, action := range actions {
		result := api.request(
			http.MethodPost, "/api/shipments/"+id+"/actions/"+action.name,
			action.token, action.body, http.StatusOK,
		)
		status := result["data"].(map[string]any)["data"].(map[string]any)["status"]
		if status != action.status {
			t.Fatalf("%s status = %v, want %s", action.name, status, action.status)
		}
	}
	wrong := api.request(
		http.MethodPost, "/api/shipments/"+id+"/actions/confirm",
		receiver, map[string]string{"deliveryCode": "000000"}, http.StatusBadRequest,
	)
	if wrong["error"].(map[string]any)["code"] != "INVALID_DELIVERY_CODE" {
		t.Fatalf("wrong code response = %#v", wrong)
	}
	received := api.request(
		http.MethodPost, "/api/shipments/"+id+"/actions/confirm",
		receiver, map[string]string{"deliveryCode": deliveryCode, "location": "南京市玄武区"},
		http.StatusOK,
	)
	if received["data"].(map[string]any)["data"].(map[string]any)["status"] != "RECEIVED" {
		t.Fatalf("receive = %#v", received)
	}
	api.request(
		http.MethodPost, "/api/shipments/"+id+"/actions/confirm",
		receiver, map[string]string{"deliveryCode": deliveryCode}, http.StatusConflict,
	)

	public := api.request(
		http.MethodGet, "/api/public/track/"+tracking, "", nil, http.StatusOK,
	)
	publicShipment := public["data"].(map[string]any)
	if _, exists := publicShipment["deliveryCodeHash"]; exists {
		t.Fatal("public response leaked deliveryCodeHash")
	}
	if publicShipment["destination"].(map[string]any)["detail"] != "详细地址已脱敏" {
		t.Fatalf("public destination = %#v", publicShipment["destination"])
	}
	firstEvent := publicShipment["events"].([]any)[0].(map[string]any)
	if _, exists := firstEvent["actorId"]; exists {
		t.Fatal("public response leaked actorId")
	}
	history := api.request(
		http.MethodGet, "/api/public/track/"+tracking+"/history", "", nil, http.StatusOK,
	)
	if len(history["data"].([]any)) != 9 {
		t.Fatalf("history length = %d", len(history["data"].([]any)))
	}
	verified := api.request(http.MethodPost, "/api/public/verify", "", map[string]string{
		"trackingNumber": tracking, "evidenceHash": strings.Repeat("c", 64),
	}, http.StatusOK)
	verifyData := verified["data"].(map[string]any)
	if verifyData["verified"] != true || verifyData["historyContinuous"] != true {
		t.Fatalf("verification = %#v", verifyData)
	}

	reloaded, err := fake.New(api.path)
	if err != nil {
		t.Fatalf("reload ledger: %v", err)
	}
	persisted, err := reloaded.ReadShipment(context.Background(), id, nil)
	if err != nil {
		t.Fatalf("read persisted shipment: %v", err)
	}
	if persisted.Status != "RECEIVED" || len(persisted.Events) != 9 {
		t.Fatalf("persisted shipment = %#v", persisted)
	}
}

func TestAuthorizationAndValidation(t *testing.T) {
	api := newTestAPI(t)
	defer api.close()
	shipper := api.login("shipper")
	auditor := api.login("auditor")
	api.request(http.MethodPost, "/api/shipments", "", map[string]any{}, http.StatusUnauthorized)
	forbidden := api.request(
		http.MethodPost, "/api/shipments", auditor, map[string]any{}, http.StatusForbidden,
	)
	if forbidden["error"].(map[string]any)["code"] != "FORBIDDEN" {
		t.Fatalf("forbidden = %#v", forbidden)
	}
	invalid := api.request(
		http.MethodPost, "/api/shipments", shipper,
		map[string]any{"origin": map[string]any{}}, http.StatusBadRequest,
	)
	if invalid["error"].(map[string]any)["code"] != "VALIDATION_ERROR" {
		t.Fatalf("invalid = %#v", invalid)
	}
}

func TestCancelFlowAndPublicGuards(t *testing.T) {
	api := newTestAPI(t)
	defer api.close()
	shipper := api.login("shipper")

	created := api.request(http.MethodPost, "/api/shipments", shipper, shipmentBody(), http.StatusCreated)
	shipment := created["data"].(map[string]any)["data"].(map[string]any)
	id := shipment["id"].(string)

	// A shipper cannot run carrier actions.
	denied := api.request(
		http.MethodPost, "/api/shipments/"+id+"/actions/accept", shipper,
		map[string]any{"location": "上海"}, http.StatusForbidden,
	)
	if denied["error"].(map[string]any)["code"] != "FORBIDDEN" {
		t.Fatalf("role guard = %#v", denied)
	}

	// Shipper cancels a pending shipment, the README-documented flow.
	cancelled := api.request(
		http.MethodPost, "/api/shipments/"+id+"/actions/cancel", shipper,
		map[string]any{"reason": "客户临时取消"}, http.StatusOK,
	)
	if cancelled["data"].(map[string]any)["data"].(map[string]any)["status"] != "CANCELLED" {
		t.Fatalf("cancel receipt = %#v", cancelled)
	}
	// Cancelling twice must conflict.
	api.request(
		http.MethodPost, "/api/shipments/"+id+"/actions/cancel", shipper,
		map[string]any{"reason": "再次取消"}, http.StatusConflict,
	)

	// Invalid tracking characters are a 400, not a ledger error.
	track := api.request(
		http.MethodGet, "/api/public/track/JX%202099", "", nil, http.StatusBadRequest,
	)
	if track["error"].(map[string]any)["code"] != "VALIDATION_ERROR" {
		t.Fatalf("invalid tracking = %#v", track)
	}
	verify := api.request(http.MethodPost, "/api/public/verify", "", map[string]string{
		"trackingNumber": "JX/2099",
	}, http.StatusBadRequest)
	if verify["error"].(map[string]any)["code"] != "VALIDATION_ERROR" {
		t.Fatalf("invalid verify tracking = %#v", verify)
	}
}

func TestVerifyReportsContinuousHistory(t *testing.T) {
	api := newTestAPI(t)
	defer api.close()
	shipper := api.login("shipper")

	created := api.request(http.MethodPost, "/api/shipments", shipper, shipmentBody(), http.StatusCreated)
	shipment := created["data"].(map[string]any)["data"].(map[string]any)
	id := shipment["id"].(string)
	tracking := shipment["trackingNumber"].(string)
	api.request(
		http.MethodPost, "/api/shipments/"+id+"/actions/cancel", shipper,
		map[string]any{}, http.StatusOK,
	)

	result := api.request(http.MethodPost, "/api/public/verify", "", map[string]string{
		"trackingNumber": tracking,
	}, http.StatusOK)
	data := result["data"].(map[string]any)
	if data["historyContinuous"] != true {
		t.Fatalf("history continuity = %#v", data)
	}
	if data["verified"] != true {
		t.Fatalf("continuous history must verify: %#v", data)
	}
	warnings, ok := data["warnings"].([]any)
	if !ok || len(warnings) != 0 {
		t.Fatalf("warning list = %#v", data["warnings"])
	}
}

func TestLoginThrottleLocksAfterRepeatedFailures(t *testing.T) {
	api := newTestAPI(t)
	defer api.close()
	for attempt := 0; attempt < 5; attempt++ {
		api.request(http.MethodPost, "/api/auth/login", "", map[string]string{
			"username": "shipper", "password": "wrong-password",
		}, http.StatusUnauthorized)
	}
	locked := api.request(http.MethodPost, "/api/auth/login", "", map[string]string{
		"username": "shipper", "password": "shipper123",
	}, http.StatusTooManyRequests)
	if locked["error"].(map[string]any)["code"] != "TOO_MANY_ATTEMPTS" {
		t.Fatalf("locked login = %#v", locked)
	}
	// A different account is unaffected.
	api.request(http.MethodPost, "/api/auth/login", "", map[string]string{
		"username": "carrier", "password": "carrier123",
	}, http.StatusOK)
}

func TestReceiverIsolation(t *testing.T) {
	api := newTestAPI(t)
	defer api.close()

	// Register a second receiver account just for this test to prove
	// shipments are only visible and confirmable by their recorded recipient.
	second := users.Account{
		User: model.User{
			ID: "receiver-other", Username: "receiver-other", DisplayName: "另一收货人",
			Role: "receiver", MSPID: "Org1MSP",
		},
		// Matches the login helper's username+"123" convention.
		Password: "receiver-other123",
	}
	users.ByUsername[second.User.Username] = second
	users.ByID[second.User.ID] = second.User
	t.Cleanup(func() {
		delete(users.ByUsername, second.User.Username)
		delete(users.ByID, second.User.ID)
	})

	shipper := api.login("shipper")
	carrier := api.login("carrier")
	stranger := api.login("receiver-other")
	owner := api.login("receiver")

	created := api.request(http.MethodPost, "/api/shipments", shipper, shipmentBody(), http.StatusCreated)
	shipment := created["data"].(map[string]any)["data"].(map[string]any)
	id := shipment["id"].(string)
	deliveryCode := created["data"].(map[string]any)["deliveryCode"].(string)
	if shipment["recipientId"] != "receiver-demo" {
		t.Fatalf("created shipment recipientId = %#v", shipment["recipientId"])
	}

	for _, action := range []struct {
		name string
		body map[string]any
	}{
		{"accept", map[string]any{"location": "上海运营中心"}},
		{"pickup", map[string]any{"location": "上海张江物流园"}},
		{"checkpoint", map[string]any{"location": "昆山中转站", "description": "干线运输正常"}},
		{"deliver", map[string]any{"location": "杭州市西湖区", "evidenceHash": strings.Repeat("d", 64)}},
	} {
		api.request(
			http.MethodPost, "/api/shipments/"+id+"/actions/"+action.name,
			carrier, action.body, http.StatusOK,
		)
	}

	// The unrecorded receiver can neither see the delivered shipment...
	denied := api.request(http.MethodGet, "/api/shipments/"+id, stranger, nil, http.StatusForbidden)
	if denied["error"].(map[string]any)["code"] != "SHIPMENT_NOT_VISIBLE" {
		t.Fatalf("stranger read = %#v", denied)
	}
	list := api.request(http.MethodGet, "/api/shipments", stranger, nil, http.StatusOK)
	if items := list["data"].(map[string]any)["items"].([]any); len(items) != 0 {
		t.Fatalf("stranger list = %#v", items)
	}
	// ...nor confirm it, even with the correct delivery code.
	confirmDenied := api.request(
		http.MethodPost, "/api/shipments/"+id+"/actions/confirm", stranger,
		map[string]string{"deliveryCode": deliveryCode}, http.StatusForbidden,
	)
	if confirmDenied["error"].(map[string]any)["code"] != "NOT_RECORDED_RECIPIENT" {
		t.Fatalf("stranger confirm = %#v", confirmDenied)
	}

	// The recorded recipient still sees and confirms it.
	api.request(http.MethodGet, "/api/shipments/"+id, owner, nil, http.StatusOK)
	received := api.request(
		http.MethodPost, "/api/shipments/"+id+"/actions/confirm", owner,
		map[string]string{"deliveryCode": deliveryCode}, http.StatusOK,
	)
	if received["data"].(map[string]any)["data"].(map[string]any)["status"] != "RECEIVED" {
		t.Fatalf("owner confirm = %#v", received)
	}
}

func TestPublicEndpointsRateLimited(t *testing.T) {
	api := newTestAPIWithLimit(t, 3)
	defer api.close()
	// The first 3 public requests in the window pass (each 404s on an unknown
	// tracking number); the 4th is throttled before reaching the handler.
	path := "/api/public/track/JX202607200001"
	for i := 0; i < 3; i++ {
		api.request(http.MethodGet, path, "", nil, http.StatusNotFound)
	}
	throttled := api.request(http.MethodGet, path, "", nil, http.StatusTooManyRequests)
	if throttled["error"].(map[string]any)["code"] != "RATE_LIMITED" {
		t.Fatalf("throttled response = %#v", throttled)
	}
	// Non-public endpoints are not affected by the public limiter.
	api.request(http.MethodGet, "/api/health", "", nil, http.StatusOK)
}

func shipmentBody() map[string]any {
	return map[string]any{
		"origin": map[string]any{
			"province": "上海市", "city": "上海市", "district": "浦东新区",
			"detail": "张江物流园 3 号仓", "contactName": "王发货",
			"contactPhone": "13800001111",
		},
		"destination": map[string]any{
			"province": "浙江省", "city": "杭州市", "district": "西湖区",
			"detail": "文三路 50 号", "contactName": "赵收货",
			"contactPhone": "13900002222",
		},
		"goods": map[string]any{
			"name": "演示货物", "category": "日用品", "quantity": 1, "weightKg": 1.2,
		},
		"expectedDeliveryDate": "2026-08-20",
	}
}
