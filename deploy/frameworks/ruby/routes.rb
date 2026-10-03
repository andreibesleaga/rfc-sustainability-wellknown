# Rails: config/routes.rb
Rails.application.routes.draw do
  match "/.well-known/sustainability-data", to: "sustainability_data#show", via: [:get, :head]
end
