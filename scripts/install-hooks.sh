#!/bin/bash

# Determine the hooks directory (works for both regular repos and worktrees)
HOOKS_DIR=$(git rev-parse --git-path hooks)

# Create the pre-commit hook
cat > "$HOOKS_DIR/pre-commit" << 'EOF'
#!/bin/bash

# Get the git root directory
GIT_ROOT=$(git rev-parse --show-toplevel)

# Get the package name from package.json
PACKAGE_NAME=$(node -p "require('$GIT_ROOT/package.json').name")

# Check if the package name contains 'internal'
if [[ $PACKAGE_NAME == *"internal"* ]]; then
    echo "Error: Package name '$PACKAGE_NAME' contains 'internal', which is not allowed."
    echo "Please remove 'internal' from the package name in package.json"
    exit 1
fi

exit 0
EOF

# Make the hook executable
chmod +x "$HOOKS_DIR/pre-commit"

echo "Git pre-commit hook installed successfully!" 
