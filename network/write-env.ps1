param(
  [string]$ChannelName = "logisticschannel",
  [string]$ChaincodeName = "logistics"
)

$ErrorActionPreference = "Stop"
$NetworkDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $NetworkDir
$TestNetwork = Join-Path $NetworkDir "fabric-samples\test-network"
$ApiDir = Join-Path $ProjectDir "apps\api"
$OutputPath = Join-Path $ApiDir ".env.fabric"

$Org1Base = Join-Path $TestNetwork "organizations\peerOrganizations\org1.example.com"
$Org2Base = Join-Path $TestNetwork "organizations\peerOrganizations\org2.example.com"

$Org1Key = Get-ChildItem -LiteralPath (Join-Path $Org1Base "users\User1@org1.example.com\msp\keystore") -File | Select-Object -First 1
$Org2Key = Get-ChildItem -LiteralPath (Join-Path $Org2Base "users\User1@org2.example.com\msp\keystore") -File | Select-Object -First 1

if (-not $Org1Key -or -not $Org2Key) {
  throw "The Org1 or Org2 Gateway private key was not found. Confirm that the Fabric network started successfully."
}

$lines = @(
  "LEDGER_MODE=fabric",
  "FABRIC_CHANNEL_NAME=$ChannelName",
  "FABRIC_CHAINCODE_NAME=$ChaincodeName",
  "FABRIC_ORG1_MSP_ID=Org1MSP",
  "FABRIC_ORG1_PEER_ENDPOINT=localhost:7051",
  "FABRIC_ORG1_PEER_HOST_ALIAS=peer0.org1.example.com",
  "FABRIC_ORG1_TLS_CERT_PATH=$(Join-Path $Org1Base 'peers\peer0.org1.example.com\tls\ca.crt')",
  "FABRIC_ORG1_CERT_PATH=$(Join-Path $Org1Base 'users\User1@org1.example.com\msp\signcerts\cert.pem')",
  "FABRIC_ORG1_KEY_PATH=$($Org1Key.FullName)",
  "FABRIC_ORG2_MSP_ID=Org2MSP",
  "FABRIC_ORG2_PEER_ENDPOINT=localhost:9051",
  "FABRIC_ORG2_PEER_HOST_ALIAS=peer0.org2.example.com",
  "FABRIC_ORG2_TLS_CERT_PATH=$(Join-Path $Org2Base 'peers\peer0.org2.example.com\tls\ca.crt')",
  "FABRIC_ORG2_CERT_PATH=$(Join-Path $Org2Base 'users\User1@org2.example.com\msp\signcerts\cert.pem')",
  "FABRIC_ORG2_KEY_PATH=$($Org2Key.FullName)"
)

Set-Content -LiteralPath $OutputPath -Value $lines -Encoding utf8
Write-Host "Generated $OutputPath. It contains machine-local certificate paths and is excluded by .gitignore."
