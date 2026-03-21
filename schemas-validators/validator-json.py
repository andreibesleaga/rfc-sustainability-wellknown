import jtd
import json
import sys
import argparse

def main():
    parser = argparse.ArgumentParser(description="Validate Sustainability Well-Known URI JSON responses.")
    parser.add_argument(
        "file", 
        nargs="?", 
        default="example-response.json", 
        help="The JSON file to validate (default: example-response.json)"
    )
    parser.add_argument(
        "--schema", 
        default="response-schema.json", 
        help="The JTD schema file (default: response-schema.json)"
    )
    args = parser.parse_args()

    try:
        # Load the JTD Schema
        with open(args.schema, 'r') as s_file:
            schema_dict = json.load(s_file)
            schema = jtd.Schema.from_dict(schema_dict)

        # Load the Data to validate
        with open(args.file, 'r') as d_file:
            instance = json.load(d_file)

        # Support both a single object and an array of objects
        items = instance if isinstance(instance, list) else [instance]
        all_errors = []
        for i, item in enumerate(items):
            errs = jtd.validate(schema=schema, instance=item)
            for e in errs:
                prefix = f"[{i}]" if isinstance(instance, list) else ""
                all_errors.append(f"{prefix} Path: {e.instance_path}, Error: {e.schema_path}")

        if not all_errors:
            print(f"Success: '{args.file}' is compliant with '{args.schema}'.")
        else:
            print(f"Validation Failed for '{args.file}':")
            for msg in all_errors:
                print(f" - {msg}")
            sys.exit(1)

    except FileNotFoundError as e:
        print(f"Error: File not found - {e.filename}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON format - {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()