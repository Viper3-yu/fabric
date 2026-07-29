package main

import (
	"log"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

func main() {
	chaincode, err := contractapi.NewChaincode(&LogisticsContract{})
	if err != nil {
		log.Fatalf("create logistics chaincode: %v", err)
	}
	if err := chaincode.Start(); err != nil {
		log.Fatalf("start logistics chaincode: %v", err)
	}
}
