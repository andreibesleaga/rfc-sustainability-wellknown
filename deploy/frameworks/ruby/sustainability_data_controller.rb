# Rails: app/controllers/sustainability_data_controller.rb (document at config/sustainability-data)
class SustainabilityDataController < ActionController::Base
  protect_from_forgery with: :null_session

  def show
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Cache-Control"] = "public, max-age=86400"
    send_data Rails.root.join("config", "sustainability-data").read,
              type: "application/sustainability-data+json", disposition: "inline"
  end
end
