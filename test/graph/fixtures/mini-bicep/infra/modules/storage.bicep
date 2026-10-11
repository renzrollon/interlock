param location string

var prefix = 'st'

resource account 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: '${prefix}acct'
  location: location
}

output accountId string = account.id
