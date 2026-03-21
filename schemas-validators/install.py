#!/usr/bin/env python3
"""Install all dependencies for the schemas-validators tools.

Python packages: jtd  (via pip, from requirements.txt)
Ruby gems:       cddl (via gem, used by validator-cddl.py)
"""

import subprocess
import sys
import os
import shutil

REQUIREMENTS = os.path.join(os.path.dirname(__file__), "requirements.txt")


def run(cmd, **kwargs):
    print(f"  $ {' '.join(cmd)}")
    return subprocess.run(cmd, check=False, **kwargs)


def install_pip_deps():
    print("\n[1/2] Installing Python packages (pip) ...")
    if not os.path.exists(REQUIREMENTS):
        print(f"Error: requirements.txt not found at {REQUIREMENTS}", file=sys.stderr)
        sys.exit(1)

    result = run([sys.executable, "-m", "pip", "install", "-r", REQUIREMENTS])
    if result.returncode != 0:
        print("      Retrying with --break-system-packages ...")
        result = run([sys.executable, "-m", "pip", "install", "-r", REQUIREMENTS,
                      "--break-system-packages"])
    if result.returncode != 0:
        print("Error: pip install failed.", file=sys.stderr)
        sys.exit(result.returncode)
    print("      OK")


def install_gem_deps():
    print("\n[2/2] Installing Ruby gems (gem install cddl) ...")
    if shutil.which("gem") is None:
        print("Error: 'gem' not found. Please install Ruby first.", file=sys.stderr)
        print("       Ubuntu/Debian: sudo apt install ruby-full", file=sys.stderr)
        print("       macOS:         brew install ruby", file=sys.stderr)
        sys.exit(1)

    result = run(["gem", "install", "cddl"])
    if result.returncode != 0:
        # Try with sudo as a fallback for system Ruby installs
        print("      Retrying with sudo ...")
        result = run(["sudo", "gem", "install", "cddl"])
    if result.returncode != 0:
        print("Error: gem install cddl failed.", file=sys.stderr)
        sys.exit(result.returncode)
    print("      OK")


def main():
    install_pip_deps()
    install_gem_deps()
    print("\nAll dependencies installed successfully.")


if __name__ == "__main__":
    main()
