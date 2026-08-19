package users

import "github.com/Viper3-yu/fabric/chaincode/logistics/model"

type Account struct {
	User model.User
	// Password is a plaintext password supplied via APP_PASSWORD_<USER>;
	// it exists for local development convenience only.
	Password string
	// PasswordHash is a bcrypt hash supplied via APP_PASSWORD_HASH_<USER>.
	// When set it takes precedence over Password and is the only accepted
	// production credential form.
	PasswordHash string
}

// Accounts defines the built-in role accounts. No credentials live in source
// code: every password or hash is supplied through environment configuration.
var Accounts = []Account{
	{
		User: model.User{
			ID: "shipper-demo", Username: "shipper", DisplayName: "星河商贸",
			Role: "shipper", MSPID: "Org1MSP",
		},
	},
	{
		User: model.User{
			ID: "carrier-demo", Username: "carrier", DisplayName: "迅达物流",
			Role: "carrier", MSPID: "Org2MSP",
		},
	},
	{
		User: model.User{
			ID: "receiver-demo", Username: "receiver", DisplayName: "确认收货人",
			Role: "receiver", MSPID: "Org1MSP",
		},
	},
	{
		User: model.User{
			ID: "auditor-demo", Username: "auditor", DisplayName: "审计员",
			Role: "auditor", MSPID: "ReadOnly",
		},
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

// Configure applies environment-provided credentials to the built-in
// accounts. APP_PASSWORD_<USER> values set the plaintext development form;
// APP_PASSWORD_HASH_<USER> values set bcrypt hashes that take precedence at
// authentication time.
func Configure(passwords map[string]string, hashes map[string]string) {
	for username, password := range passwords {
		account, ok := ByUsername[username]
		if !ok {
			continue
		}
		account.Password = password
		account.PasswordHash = ""
		ByUsername[username] = account
	}
	for username, hash := range hashes {
		account, ok := ByUsername[username]
		if !ok {
			continue
		}
		account.PasswordHash = hash
		ByUsername[username] = account
	}
}

// ReceiverAccountID returns the account new shipments are addressed to. With
// the single built-in receiver this is a constant; a multi-receiver user
// store would replace it with a per-shipment selection.
func ReceiverAccountID() string {
	if account, ok := ByUsername[ReceiverUsername]; ok {
		return account.User.ID
	}
	return ""
}

// ReceiverUsername is the built-in consignee account name.
const ReceiverUsername = "receiver"
