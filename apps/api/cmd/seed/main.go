// Command seed writes a varied set of shipments onto the real Fabric ledger
// through the chaincode state machine, so the workbench and public pages have
// representative records to browse. Every scenario already present (matched
// by shipment id) is skipped, so the command is safe to rerun.
//
// Usage (against a running Fabric network):
//
//	$env:ENV_FILE = (Resolve-Path ".\apps\api\.env.fabric").Path
//	go run ./apps/api/cmd/seed
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"time"

	"github.com/Viper3-yu/fabric/apps/api/internal/config"
	"github.com/Viper3-yu/fabric/apps/api/internal/ledger"
	"github.com/Viper3-yu/fabric/apps/api/internal/users"
	"github.com/Viper3-yu/fabric/chaincode/logistics/model"
)

type step struct {
	action      string // accept | pickup | checkpoint | deliver | confirm | cancel
	location    string
	description string
	temperature *float64
}

type scenario struct {
	id          string
	tracking    string
	origin      model.Address
	destination model.Address
	goods       model.GoodsInfo
	tempRange   *model.TemperatureRange
	// deliveryCode is consumed by the confirm step; after confirmation it has
	// no further meaning, so fixed per-scenario codes are fine.
	deliveryCode string
	steps        []step
}

func address(province, city, district, detail, contact, phone string) model.Address {
	return model.Address{
		Province: province, City: city, District: district, Detail: detail,
		ContactName: contact, ContactPhoneMasked: phone,
	}
}

func temperature(value float64) *float64 { return &value }

// maskName keeps the first rune of a Chinese name and masks the rest, matching
// the API's recipient masking shape.
func maskName(name string) string {
	runes := []rune(name)
	if len(runes) == 0 {
		return "**"
	}
	return string(runes[0]) + "**"
}

func range2_8() *model.TemperatureRange { return &model.TemperatureRange{Min: 2, Max: 8, Unit: "C"} }

func scenarios() []scenario {
	return []scenario{
		{
			id: "shipment-seed-01", tracking: "JXSEED0001",
			origin:      address("上海市", "上海市", "浦东新区", "张江医药物流园 3 号库", "陈医生", "138****1001"),
			destination: address("北京市", "北京市", "大兴区", "亦庄生物医药园 B2 收货站", "刘主任", "139****2001"),
			goods:       model.GoodsInfo{Name: "流感疫苗", Category: "医药冷链", Quantity: 24, WeightKG: 18.5},
			tempRange:   range2_8(), deliveryCode: "135790",
			steps: []step{
				{action: "accept", location: "上海运营中心"},
				{action: "pickup", location: "张江医药物流园"},
				{action: "checkpoint", location: "苏州冷链中转站", description: "干线温控运输正常", temperature: temperature(4.2)},
				{action: "checkpoint", location: "济南分拨中心", description: "恒温仓暂存后继续北上", temperature: temperature(5.1)},
				{action: "deliver", location: "北京亦庄生物医药园", description: "已送达收货站，等待签收"},
				{action: "confirm", location: "北京亦庄生物医药园", description: "验收合格，确认收货"},
			},
		},
		{
			id: "shipment-seed-02", tracking: "JXSEED0002",
			origin:      address("广东省", "广州市", "白云区", "白云生鲜集散中心 A 区", "周经理", "137****3002"),
			destination: address("湖北省", "武汉市", "洪山区", "光谷生鲜配送仓", "何店长", "136****4002"),
			goods:       model.GoodsInfo{Name: "进口车厘子", Category: "生鲜冷链", Quantity: 60, WeightKG: 420},
			tempRange:   &model.TemperatureRange{Min: 0, Max: 4, Unit: "C"}, deliveryCode: "246810",
			steps: []step{
				{action: "accept", location: "广州运营中心"},
				{action: "pickup", location: "白云生鲜集散中心"},
				{action: "checkpoint", location: "韶关冷链驿站", description: "冷藏车温度稳定", temperature: temperature(2.4)},
				{action: "checkpoint", location: "长沙北分拨中心", description: "转运时温控探头读数偏高", temperature: temperature(6.8)},
				{action: "resolve", location: "长沙北分拨中心", description: "更换冷柜并复检合格，恢复发运"},
				{action: "deliver", location: "武汉光谷生鲜配送仓", description: "凌晨班次送达"},
				{action: "confirm", location: "武汉光谷生鲜配送仓", description: "抽样检查合格，确认收货"},
			},
		},
		{
			id: "shipment-seed-03", tracking: "JXSEED0003",
			origin:      address("四川省", "成都市", "双流区", "西南医药物流中心 2 号库", "李主管", "135****5003"),
			destination: address("陕西省", "西安市", "未央区", "经开区医药产业园收货处", "赵药师", "133****6003"),
			goods:       model.GoodsInfo{Name: "诊断试剂", Category: "医药冷链", Quantity: 12, WeightKG: 9.8},
			tempRange:   range2_8(), deliveryCode: "909090",
			steps: []step{
				{action: "accept", location: "成都运营中心"},
				{action: "pickup", location: "西南医药物流中心"},
				{action: "checkpoint", location: "汉中转运站", description: "全程温控正常", temperature: temperature(3.8)},
				{action: "deliver", location: "西安经开区医药产业园", description: "已送达，等待药房验收"},
			},
		},
		{
			id: "shipment-seed-04", tracking: "JXSEED0004",
			origin:      address("浙江省", "杭州市", "余杭区", "仓前电子产业园发货仓", "孙工", "138****7004"),
			destination: address("江苏省", "南京市", "建邺区", "河西软件谷收货点", "钱工", "139****8004"),
			goods:       model.GoodsInfo{Name: "服务器整机", Category: "电子设备", Quantity: 4, WeightKG: 96},
			steps: []step{
				{action: "accept", location: "杭州运营中心"},
				{action: "pickup", location: "仓前电子产业园"},
				{action: "checkpoint", location: "湖州分拨中心", description: "防震托盘完好"},
				{action: "checkpoint", location: "宜兴中转站", description: "按计划发运末班车"},
			},
		},
		{
			id: "shipment-seed-05", tracking: "JXSEED0005",
			origin:      address("北京市", "北京市", "顺义区", "临空精密仪器仓", "郭工", "136****9005"),
			destination: address("上海市", "上海市", "闵行区", "紫竹高新区收货码头", "沈工", "137****0105"),
			goods:       model.GoodsInfo{Name: "光学测量仪", Category: "精密仪器", Quantity: 2, WeightKG: 58},
			steps: []step{
				{action: "accept", location: "北京运营中心"},
				{action: "pickup", location: "顺义临空仓"},
				{action: "checkpoint", location: "沧州南驿站", description: "气垫悬挂车辆运输中"},
			},
		},
		{
			id: "shipment-seed-06", tracking: "JXSEED0006",
			origin:      address("广东省", "深圳市", "龙岗区", "平湖乳品冷链仓", "马经理", "135****0206"),
			destination: address("湖南省", "长沙市", "岳麓区", "麓谷冷链收货仓", "冯店长", "133****0306"),
			goods:       model.GoodsInfo{Name: "巴氏杀菌乳", Category: "食品冷链", Quantity: 180, WeightKG: 810},
			tempRange:   &model.TemperatureRange{Min: 0, Max: 6, Unit: "C"}, deliveryCode: "464646",
			steps: []step{
				{action: "accept", location: "深圳运营中心"},
				{action: "pickup", location: "平湖乳品冷链仓"},
				{action: "checkpoint", location: "郴州冷链驿站", description: "冷藏箱制冷异常，等待处理", temperature: temperature(9.5)},
			},
		},
		{
			id: "shipment-seed-07", tracking: "JXSEED0007",
			origin:      address("重庆", "重庆市", "渝北区", "空港百货集散仓", "唐主管", "138****0407"),
			destination: address("贵州省", "贵阳市", "观山湖区", "电商产业园末端仓", "文店长", "139****0507"),
			goods:       model.GoodsInfo{Name: "家居日用百货", Category: "日用百货", Quantity: 320, WeightKG: 1450},
			steps: []step{
				{action: "accept", location: "重庆运营中心"},
				{action: "pickup", location: "空港百货集散仓"},
			},
		},
		{
			id: "shipment-seed-08", tracking: "JXSEED0008",
			origin:      address("湖北省", "武汉市", "蔡甸区", "常福汽车零部件园", "蔡工", "137****0608"),
			destination: address("河南省", "郑州市", "管城回族区", "经开汽车产业园收货区", "岳工", "136****0708"),
			goods:       model.GoodsInfo{Name: "新能源汽车电驱总成", Category: "汽车配件", Quantity: 16, WeightKG: 720},
			steps: []step{
				{action: "accept", location: "武汉运营中心"},
			},
		},
		{
			id: "shipment-seed-09", tracking: "JXSEED0009",
			origin:      address("上海市", "上海市", "青浦区", "赵巷服装品牌仓", "施经理", "135****0809"),
			destination: address("浙江省", "杭州市", "拱墅区", "武林银泰收货部", "姚店长", "133****0909"),
			goods:       model.GoodsInfo{Name: "秋冬新款外套", Category: "服装", Quantity: 85, WeightKG: 210},
		},
		{
			id: "shipment-seed-10", tracking: "JXSEED0010",
			origin:      address("江苏省", "南京市", "栖霞区", "龙潭图书发行仓", "华主管", "138****1010"),
			destination: address("安徽省", "合肥市", "包河区", "滨湖文化广场收货处", "凌老师", "139****1110"),
			goods:       model.GoodsInfo{Name: "教辅图书套装", Category: "图书文教", Quantity: 200, WeightKG: 640},
		},
		{
			id: "shipment-seed-11", tracking: "JXSEED0011",
			origin:      address("天津市", "天津市", "滨海新区", "港东家电发运仓", "纪经理", "136****1211"),
			destination: address("河北省", "石家庄市", "裕华区", "方村家电仓", "梁店长", "137****1311"),
			goods:       model.GoodsInfo{Name: "滚筒洗衣机", Category: "家用电器", Quantity: 40, WeightKG: 1120},
			steps: []step{
				{action: "cancel", location: "天津滨海新区", description: "渠道调价，客户整单取消后重新下单"},
			},
		},
		{
			id: "shipment-seed-12", tracking: "JXSEED0012",
			origin:      address("山东省", "青岛市", "城阳区", "胶州湾海产冷链仓", "巩经理", "135****1412"),
			destination: address("辽宁省", "沈阳市", "于洪区", "沙岭海鲜批发市场冷库", "瞿老板", "133****1512"),
			goods:       model.GoodsInfo{Name: "冷冻对虾", Category: "食品冷链", Quantity: 96, WeightKG: 480},
			tempRange:   &model.TemperatureRange{Min: -18, Max: -12, Unit: "C"}, deliveryCode: "717171",
			steps: []step{
				{action: "accept", location: "青岛运营中心"},
				{action: "pickup", location: "胶州湾海产冷链仓"},
				{action: "checkpoint", location: "潍坊北冷链站", description: "冷冻舱温稳定", temperature: temperature(-15.6)},
				{action: "checkpoint", location: "山海关分拨中心", description: "夜间干线直发", temperature: temperature(-16.2)},
				{action: "deliver", location: "沈阳沙岭海鲜市场冷库", description: "低温验收通道收货"},
				{action: "confirm", location: "沈阳沙岭海鲜市场冷库", description: "中心温度抽检合格，确认收货"},
			},
		},
	}
}

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	store, err := ledger.NewFabric(cfg.Fabric)
	if err != nil {
		log.Fatal(err)
	}
	defer func() {
		if err := store.Close(); err != nil {
			log.Printf("close ledger: %v", err)
		}
	}()
	if health := store.Health(context.Background()); health.Status != "ok" {
		log.Fatalf("fabric health is %s; start the network before seeding", health.Status)
	}

	shipper := users.ByUsername["shipper"].User
	carrier := users.ByUsername["carrier"].User
	receiver := users.ByUsername["receiver"].User

	created, skipped := 0, 0
	for _, scene := range scenarios() {
		if _, err := store.ReadShipment(context.Background(), scene.id, nil); err == nil {
			skipped++
			continue
		}
		if err := runScenario(store, scene, shipper, carrier, receiver); err != nil {
			log.Fatalf("scenario %s: %v", scene.id, err)
		}
		created++
		fmt.Printf("[seed] %s %s -> %s 已写入\n", scene.tracking, scene.origin.City, scene.destination.City)
	}
	fmt.Printf("[seed] done: %d created, %d already present\n", created, skipped)
}

func runScenario(
	store *ledger.Fabric,
	scene scenario,
	shipper, carrier, receiver model.User,
) error {
	ctx := context.Background()
	codeHash := sha256.Sum256([]byte(scene.deliveryCode))
	documentHash := sha256.Sum256([]byte("seed-document-" + scene.id))
	if _, err := store.CreateShipment(ctx, ledger.CreateShipmentCommand{
		ID:                   scene.id,
		TrackingNumber:       scene.tracking,
		Origin:               scene.origin,
		Destination:          scene.destination,
		Goods:                scene.goods,
		RecipientMasked:      maskName(scene.destination.ContactName) + " · " + scene.destination.ContactPhoneMasked,
		RecipientID:          receiver.ID,
		ExpectedDeliveryDate: time.Now().UTC().AddDate(0, 0, 3).Format("2006-01-02"),
		TemperatureRange:     scene.tempRange,
		DeliveryCodeHash:     hex.EncodeToString(codeHash[:]),
		DocumentHash:         hex.EncodeToString(documentHash[:]),
	}, shipper); err != nil {
		return fmt.Errorf("create: %w", err)
	}
	for index, action := range scene.steps {
		command := ledger.ActionCommand{
			Location: action.location, Description: action.description,
			Temperature: action.temperature,
		}
		var err error
		switch action.action {
		case "accept":
			_, err = store.AcceptShipment(ctx, scene.id, command, carrier)
		case "pickup":
			_, err = store.PickupShipment(ctx, scene.id, command, carrier)
		case "checkpoint":
			_, err = store.AddCheckpoint(ctx, scene.id, command, carrier)
		case "resolve":
			_, err = store.ResolveException(ctx, scene.id, command, carrier)
		case "deliver":
			evidence := sha256.Sum256([]byte("seed-delivery-" + scene.id))
			command.EvidenceHash = hex.EncodeToString(evidence[:])
			_, err = store.MarkDelivered(ctx, scene.id, command, carrier)
		case "confirm":
			_, err = store.ConfirmReceipt(ctx, scene.id, ledger.ConfirmCommand{
				ActionCommand: command, DeliveryCode: scene.deliveryCode,
			}, receiver)
		case "cancel":
			command.Description = action.description
			_, err = store.CancelShipment(ctx, scene.id, command, shipper)
		default:
			err = fmt.Errorf("unknown action %q", action.action)
		}
		if err != nil {
			return fmt.Errorf("step %d (%s): %w", index+1, action.action, err)
		}
	}
	return nil
}
