import json
from jsonschema import validate, ValidationError

# The JSON Schema derived from the draft's CDDL
SUSTAINABILITY_SCHEMA = {
    "type": ["object", "array"],
    "items": {"$ref": "#/definitions/metrics"},
    "definitions": {
        "metrics": {
            "type": "object",
            "properties": {
                "capabilities": {"enum": ["basic", "extended"]},
                "methodology-type": {
                    "enum": [
                        "hardware-metered",
                        "hardware-estimated",
                        "cloud-billing",
                        "third-party-modeled"
                    ]
                },
                "methodology-uri": {"type": "string", "format": "uri"},
                "reporting-period": {"type": "string"},
                "energy-consumption": {"type": "number"},
                "energy-unit": {"enum": ["Wh", "kWh", "MWh", "GWh"]},
                "carbon-footprint": {"type": "number"},
                "carbon-unit": {"enum": ["gCO2e", "kgCO2e", "mtCO2e"]},
                "target-path": {"type": "string"},
                "carbon-accounting": {"enum": ["location-based", "market-based"]},
                "scope-1": {"type": "number"},
                "scope-2": {"type": "number"},
                "scope-3": {"type": "number"},
                "sci-score": {"type": "number"}
            },
            "required": [
                "capabilities",
                "methodology-type",
                "methodology-uri",
                "reporting-period",
                "energy-consumption",
                "energy-unit",
                "carbon-footprint",
                "carbon-unit"
            ]
        }
    }
}

def validate_sustainability_response(data):
    """
    Validates a JSON response against the draft-besleaga-green-sustainability-wellknown-01 schema.
    """
    try:
        # If it's a single object, wrap it in a list check logic or check directly
        if isinstance(data, dict):
            validate(instance=data, schema=SUSTAINABILITY_SCHEMA["definitions"]["metrics"])
        else:
            validate(instance=data, schema=SUSTAINABILITY_SCHEMA)
            
        print("✅ Validation Successful: Response complies with the RFC draft.")
        return True
    except ValidationError as e:
        print(f"❌ Validation Failed: {e.message}")
        print(f"Path to error: {list(e.path)}")
        return False

# Example Usage
if __name__ == "__main__":
    # Sample data to test
    test_response = {
        "capabilities": "basic",
        "methodology-type": "cloud-billing",
        "methodology-uri": "https://example.com/methodology",
        "reporting-period": "2026-02",
        "energy-consumption": 1200.5,
        "energy-unit": "kWh",
        "carbon-footprint": 340000,
        "carbon-unit": "gCO2e"
    }
    
    validate_sustainability_response(test_response)