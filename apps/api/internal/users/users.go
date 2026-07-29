package users

import "github.com/Viper3-yu/fabric/chaincode/logistics/model"

type Account struct {
	User     model.User
	Password string
}

var Accounts = []Account{
	{
		User: model.User{
			ID: "shipper-demo", Username: "shipper", DisplayName: "星河商贸",
			Role: "shipper", MSPID: "Org1MSP",
		},
		Password: "shipper123",
	},
	{
		User: model.User{
			ID: "carrier-demo", Username: "carrier", DisplayName: "迅达物流",
			Role: "carrier", MSPID: "Org2MSP",
		},
		Password: "carrier123",
	},
	{
		User: model.User{
			ID: "receiver-demo", Username: "receiver", DisplayName: "演示收货人",
			Role: "receiver", MSPID: "Org1MSP",
		},
		Password: "receiver123",
	},
	{
		User: model.User{
			ID: "auditor-demo", Username: "auditor", DisplayName: "课程审计员",
			Role: "auditor", MSPID: "ReadOnly",
		},
		Password: "auditor123",
	},
}

var (
	ByUsername = make(map[string]Account, len(Accounts))
	ByID       = make(map[string]model.User, len(Accounts))
)

func init() {
	for _, account := range Accounts {
		ByUsername[account.User.Username] = account
		ByID[account.User.ID] = account.User
	}
}
