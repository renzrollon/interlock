param deploy bool = true
param names array = []

@description('the sku')
param sku string = 'Standard_LRS'

module storage './modules/storage.bicep' = {
  name: 'storage'
  params: {
    location: 'westeurope'
  }
}

module a './a.bicep' = if (deploy) {
  name: 'a'
}

module b '../shared/b.bicep' = [for n in names: {
  name: 'b-${n}'
}]

module shared 'br:acme.azurecr.io/bicep/shared:v1' = {
  name: 'shared'
}

output id string = storage.outputs.accountId
output gone string = storage.outputs.missing
