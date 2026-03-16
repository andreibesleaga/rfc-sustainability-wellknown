import subprocess
import sys
import os
import argparse

def main():
    # Setup argument parser
    parser = argparse.ArgumentParser(description="Validate Sustainability JSON against CDDL")
    parser.add_argument(
        "filename", 
        nargs="?", 
        default="example_response1.json", 
        help="JSON file to validate (default: example_response1.json)"
    )
    args = parser.parse_args()

    cddl_schema = "response-schema.cddl"
    json_input = args.filename

    # 1. Verify files exist
    if not os.path.exists(cddl_schema):
        print(f"❌ Error: Schema file '{cddl_schema}' not found in current directory.")
        sys.exit(1)
    
    if not os.path.exists(json_input):
        print(f"❌ Error: Input file '{json_input}' not found.")
        sys.exit(1)

    print(f"🔍 Validating '{json_input}' against '{cddl_schema}'...")

    # 2. Execute validation using the 'cddl' tool
    try:
        # Corrected Command: cddl <schema> validate <input>
        # The tool detects JSON format automatically.
        process = subprocess.run(
            ["cddl", cddl_schema, "validate", json_input],
            capture_output=True,
            text=True
        )

        if process.returncode == 0:
            print("✅ Validation Successful: The response matches the CDDL schema.")
        else:
            print("❌ Validation Failed!")
            print("-" * 40)
            print("Details from validator:")
            # Print both stdout and stderr to capture all error details
            print(process.stdout)
            print(process.stderr)
            print("-" * 40)
            sys.exit(1)

    except FileNotFoundError:
        print("❌ Error: 'cddl' tool not found.")
        print("Please ensure you have run: 'gem install cddl'")
        sys.exit(1)

if __name__ == "__main__":
    main()