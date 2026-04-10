#!/bin/bash

# Exit on any error
set -e

# Colors for better visual feedback
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check Node.js version meets minimum requirement from package.json
check_node_version() {
    # Load mise if available (not loaded in non-interactive bash shells)
    if [ -f "$HOME/.local/bin/mise" ]; then
        eval "$("$HOME/.local/bin/mise" activate bash)" 2>/dev/null || true
    fi

    # Load nvm if available (not loaded in non-interactive bash shells)
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    [ -f ".nvmrc" ] && nvm use --silent 2>/dev/null || true

    REQUIRED_NODE_MAJOR=$(node -e "const e=require('./package.json').engines?.node||'';const m=e.match(/(\d+)/);process.stdout.write(m?m[1]:'')" 2>/dev/null)
    CURRENT_NODE_MAJOR=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)

    if [ -z "$CURRENT_NODE_MAJOR" ]; then
        echo -e "${RED}Error: Node.js is not installed or not in PATH.${NC}"
        exit 1
    fi
    if [ -n "$REQUIRED_NODE_MAJOR" ] && [ "$CURRENT_NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
        echo -e "${RED}Error: Node.js v${REQUIRED_NODE_MAJOR}+ is required (from package.json), but you are running $(node --version).${NC}"
        echo -e "${BLUE}Run 'nvm use ${REQUIRED_NODE_MAJOR}' in this terminal, or run 'nvm alias default ${REQUIRED_NODE_MAJOR}' and restart your terminal.${NC}"
        exit 1
    fi
}

# Function to check if .deployment.config exists and load variables
check_existing_config() {
    if [ -f ".deployment.config" ]; then
        echo -e "${BLUE}Found existing deployment configuration.${NC}"
        source .deployment.config
        
        # Check if required variables exist in the config
        if [[ -n "$APP_ID" && -n "$USERNAME" && -n "$EMAIL" && -n "$REGION" ]]; then
            return 0
        fi
    fi
    return 1
}

# Function to display existing configuration and ask if user wants to use it
use_existing_config() {
    echo -e "\n${GREEN}Existing deployment configuration:${NC}"
    echo -e "Username: ${BLUE}${USERNAME:-N/A}${NC}"
    echo -e "Given Name: ${BLUE}${GIVEN_NAME:-N/A}${NC}"
    echo -e "Family Name: ${BLUE}${FAMILY_NAME:-N/A}${NC}"
    echo -e "Email: ${BLUE}${EMAIL:-N/A}${NC}"
    echo -e "Region: ${BLUE}${REGION:-N/A}${NC}"
    echo -e "App ID: ${BLUE}${APP_ID:-N/A}${NC}"
    
    while true; do
        echo -e "\n${BLUE}Would you like to use this existing configuration? (y/n)${NC}"
        read -r use_existing
        case $use_existing in
            [Yy]* ) return 0;;
            [Nn]* ) return 1;;
            * ) echo -e "${RED}Please answer y or n${NC}";;
        esac
    done
}

# Function to get user input with validation
get_input() {
    local prompt="$1"
    local var_name="$2"
    local value=""
    while true; do
        echo -e "${BLUE}$prompt${NC}"
        read -r value
        if [ -z "$value" ]; then
            echo -e "${RED}This field cannot be empty. Please try again.${NC}"
        else
            eval "$var_name='$value'"
            break
        fi
    done
}

# Function to get AWS region
get_region() {
    echo -e "${BLUE}Enter AWS region (press Enter for default: us-east-1):${NC}"
    read -r choice
    if [ -z "$choice" ]; then
        REGION="us-east-1"
    else
        REGION="$choice"
    fi
}

# Function to get deployment type
get_deployment_type() {
    while true; do
        echo -e "${BLUE}Select deployment type:${NC}"
        echo -e "1) Both backend and frontend ${GREEN}(default)${NC}"
        echo "2) Backend only"
        echo "3) Frontend only"
        read -r choice
        if [ -z "$choice" ]; then
            DEPLOY_TYPE="both"
            break
        fi
        case $choice in
            1) DEPLOY_TYPE="both"; break;;
            2) DEPLOY_TYPE="backend"; break;;
            3) DEPLOY_TYPE="frontend"; break;;
            *) echo -e "${RED}Invalid choice. Please select 1, 2, or 3${NC}";;
        esac
    done
}

# Function to confirm inputs
confirm_inputs() {
    echo -e "\n${GREEN}Please confirm your inputs:${NC}"
    echo -e "Username: ${BLUE}$USERNAME${NC}"
    echo -e "Given Name: ${BLUE}$GIVEN_NAME${NC}"
    echo -e "Family Name: ${BLUE}$FAMILY_NAME${NC}"
    echo -e "Email: ${BLUE}$EMAIL${NC}"
    echo -e "Region: ${BLUE}$REGION${NC}"
    echo -e "Deployment Type: ${BLUE}$DEPLOY_TYPE${NC}"
    
    while true; do
        echo -e "\n${BLUE}Is this correct? (y/n)${NC}"
        read -r confirm
        case $confirm in
            [Yy]* ) return 0;;
            [Nn]* ) return 1;;
            * ) echo -e "${RED}Please answer y or n${NC}";;
        esac
    done
}

# Welcome message
clear
echo -e "${GREEN}Welcome to the Deployment Wizard!${NC}"
echo -e "This wizard will guide you through the deployment process.\n"

# Check for existing configuration
USE_EXISTING=false
if check_existing_config; then
    if use_existing_config; then
        USE_EXISTING=true
    else
        echo -e "\n${BLUE}Starting fresh configuration...${NC}"
    fi
fi

# Main wizard loop if not using existing config
if [ "$USE_EXISTING" = false ]; then
    while true; do
        # Get deployment type first
        get_deployment_type
        
        # Get AWS region
        get_region
        
        # Only gather user details if deploying backend or both
        if [ "$DEPLOY_TYPE" != "frontend" ]; then
            # Get user inputs
            get_input "Enter username:" USERNAME
            # Email validation
            while true; do
                get_input "Enter email:" EMAIL
                if [[ $EMAIL =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
                    break
                else
                    echo -e "${RED}Invalid email format. Please try again.${NC}"
                fi
            done
            get_input "Enter given name:" GIVEN_NAME
            get_input "Enter family name:" FAMILY_NAME
        fi
        
        # Modify confirm_inputs function to show different information based on deployment type
        echo -e "\n${GREEN}Please confirm your inputs:${NC}"
        echo -e "Deployment Type: ${BLUE}$DEPLOY_TYPE${NC}"
        echo -e "Region: ${BLUE}$REGION${NC}"
        if [ "$DEPLOY_TYPE" != "frontend" ]; then
            echo -e "Username: ${BLUE}$USERNAME${NC}"
            echo -e "Given Name: ${BLUE}$GIVEN_NAME${NC}"
            echo -e "Family Name: ${BLUE}$FAMILY_NAME${NC}"
            echo -e "Email: ${BLUE}$EMAIL${NC}"
        fi
        
        while true; do
            echo -e "\n${BLUE}Is this correct? (y/n)${NC}"
            read -r confirm
            case $confirm in
                [Yy]* ) break 2;; # Break out of both loops
                [Nn]* ) break;;   # Break out of just the confirmation loop
                * ) echo -e "${RED}Please answer y or n${NC}";;
            esac
        done
        echo -e "\n${BLUE}Let's start over...${NC}\n"
    done
else
    # If using existing config, still need to set deployment type
    get_deployment_type
fi

ZIP_FILE="build.zip"
BRANCH="dev"

# Backend deployment function
deploy_backend() {
    echo -e "\n${GREEN}Deploying backend infrastructure...${NC}"
    
    # Change to terraform directory
    cd ./infra

    # Initialize Terraform if .terraform directory doesn't exist
    if [ ! -d ".terraform" ]; then
        echo -e "${BLUE}Initializing Terraform...${NC}"
        if ! terraform init; then
            echo -e "${RED}Terraform initialization failed. Exiting...${NC}"
            exit 1
        fi
    else
        # Check if terraform init needs to be run with --upgrade
        echo -e "${BLUE}Checking Terraform provider versions...${NC}"
        if ! terraform init -upgrade=false > /dev/null 2>&1; then
            echo -e "${BLUE}Provider version mismatch detected. Running terraform init --upgrade...${NC}"
            if ! terraform init -upgrade; then
                echo -e "${RED}Terraform initialization with upgrade failed. Exiting...${NC}"
                exit 1
            fi
        else
            echo -e "${GREEN}Terraform providers are up to date.${NC}"
        fi
    fi

    # Build terraform command with variables
    TF_VARS="-var=username=$USERNAME"
    TF_VARS="$TF_VARS -var=given_name=$GIVEN_NAME"
    TF_VARS="$TF_VARS -var=family_name=$FAMILY_NAME"
    TF_VARS="$TF_VARS -var=email=$EMAIL"
    TF_VARS="$TF_VARS -var=region=$REGION"
    
    # Run terraform apply with variables and capture the exit status
    if ! terraform apply -auto-approve $TF_VARS; then
        echo -e "${RED}Terraform apply failed. Exiting...${NC}"
        exit 1
    fi

    # Extract values from terraform output
    if ! APP_ID=$(terraform output -raw amplify_app_id) || \
       ! VITE_COGNITO_REGION=$(terraform output -raw region) || \
       ! VITE_USER_POOL_ID=$(terraform output -raw user_pool_id) || \
       ! VITE_APP_CLIENT_ID=$(terraform output -raw app_client_id) || \
       ! VITE_COGNITO_DOMAIN=$(terraform output -raw cognito_domain); then
        echo -e "${RED}Failed to get one or more required Terraform outputs. Exiting...${NC}"
        exit 1
    fi
    
    # Extract sparky model config for frontend
    VITE_SPARKY_MODEL_CONFIG=$(terraform output -raw sparky_model_config_frontend)
    
    # Retrieve Sparky ARN (always enabled)
    if ! VITE_APP_SPARKY=$(terraform output -raw agent_runtime_arn_escaped); then
        echo -e "${RED}Failed to get Sparky ARN from Terraform output. Exiting...${NC}"
        exit 1
    fi
    
    # Retrieve Core-Services ARN
    if ! VITE_CORE_SERVICES_ENDPOINT=$(terraform output -raw core_services_runtime_arn_escaped); then
        echo -e "${RED}Failed to get Core-Services ARN from Terraform output. Exiting...${NC}"
        exit 1
    fi
    
    VITE_REDIRECT_SIGN_IN="https://dev.${APP_ID}.amplifyapp.com"
    VITE_REDIRECT_SIGN_OUT="https://dev.${APP_ID}.amplifyapp.com"
    export AWS_DEFAULT_REGION=$REGION

    # Return to root directory
    cd ..

    # Create .env file
    cat > .env << EOF
VITE_APP_SPARKY=$VITE_APP_SPARKY
VITE_CORE_SERVICES_ENDPOINT=$VITE_CORE_SERVICES_ENDPOINT
VITE_COGNITO_REGION=$VITE_COGNITO_REGION
VITE_USER_POOL_ID=$VITE_USER_POOL_ID
VITE_APP_CLIENT_ID=$VITE_APP_CLIENT_ID
VITE_COGNITO_DOMAIN=$VITE_COGNITO_DOMAIN
VITE_REDIRECT_SIGN_IN=$VITE_REDIRECT_SIGN_IN
VITE_REDIRECT_SIGN_OUT=$VITE_REDIRECT_SIGN_OUT
VITE_SPARKY_MODEL_CONFIG=$VITE_SPARKY_MODEL_CONFIG
EOF

    # Create .deployment.config file
    cat > .deployment.config << EOF
APP_ID=$APP_ID
BRANCH=$BRANCH
USERNAME=$USERNAME
EMAIL=$EMAIL
GIVEN_NAME=$GIVEN_NAME
FAMILY_NAME=$FAMILY_NAME
REGION=$REGION
EOF

    echo -e "${GREEN}Backend deployment completed successfully${NC}"
}

# Frontend deployment function
deploy_frontend() {
    echo -e "\n${GREEN}Deploying frontend...${NC}"

    check_node_version

    # Check for deployment config file
    if [ ! -f ".deployment.config" ]; then
        echo -e "${RED}Error: .deployment.config file not found. Please deploy backend first.${NC}"
        echo -e "${BLUE}The .deployment.config file is required for frontend deployment as it contains the Amplify app ID.${NC}"
        exit 1
    fi


    # Load deployment config
    source .deployment.config

    if [ -z "$APP_ID" ]; then
        echo -e "${RED}Error: APP_ID not found in .deployment.config${NC}"
        exit 1
    fi

    # Check for .env file
    if [ ! -f ".env" ]; then
        echo -e "${RED}Error: .env file not found. Please deploy backend first or ensure .env file exists.${NC}"
        echo -e "${BLUE}The .env file is required for frontend deployment as it contains necessary configuration.${NC}"
        exit 1
    fi

    # Verify required variables in .env
    required_vars=("VITE_COGNITO_REGION" "VITE_USER_POOL_ID" "VITE_APP_CLIENT_ID" "VITE_COGNITO_DOMAIN" "VITE_REDIRECT_SIGN_IN" "VITE_REDIRECT_SIGN_OUT")
    
    missing_vars=0
    for var in "${required_vars[@]}"; do
        if ! grep -q "^${var}=" .env; then
            echo -e "${RED}Error: ${var} is missing in .env file${NC}"
            missing_vars=1
        fi
    done

    if [ $missing_vars -eq 1 ]; then
        echo -e "${RED}Required variables are missing in .env file. Please deploy backend first.${NC}"
        exit 1
    fi

    # Load environment variables from .env (use while-read to handle values with spaces/JSON)
    set -a
    while IFS='=' read -r key value; do
        # Skip empty lines and comments
        [[ -z "$key" || "$key" =~ ^# ]] && continue
        export "$key=$value"
    done < .env
    set +a

    # Install npm dependencies
    echo -e "${BLUE}Installing npm dependencies...${NC}"
    if ! npm install; then
        echo -e "${RED}npm install failed. Exiting...${NC}"
        exit 1
    fi

    # Build the project
    if ! npm run build; then
        echo -e "${RED}npm build failed. Exiting...${NC}"
        exit 1
    fi

    # Compress the contents in dist folder
    cd dist && zip -r ../$ZIP_FILE . && cd ..

    # Create deployment and capture the response
    if ! DEPLOYMENT_INFO=$(aws amplify create-deployment --app-id $APP_ID --branch-name $BRANCH --region $VITE_COGNITO_REGION); then
        echo -e "${RED}Failed to create Amplify deployment. Exiting...${NC}"
        exit 1
    fi

    # Extract jobId and zipUploadUrl from the response
    JOB_ID=$(echo $DEPLOYMENT_INFO | jq -r '.jobId')
    UPLOAD_URL=$(echo $DEPLOYMENT_INFO | jq -r '.zipUploadUrl')

    if [ -z "$JOB_ID" ] || [ -z "$UPLOAD_URL" ]; then
        echo -e "${RED}Failed to extract job ID or upload URL. Exiting...${NC}"
        exit 1
    fi

    # Upload the zip file
    if ! curl -H "Content-Type: application/zip" -X PUT -T $ZIP_FILE "$UPLOAD_URL"; then
        echo -e "${RED}Failed to upload zip file. Exiting...${NC}"
        exit 1
    fi

    # Start the deployment
    if ! aws amplify start-deployment \
        --region $VITE_COGNITO_REGION \
        --app-id $APP_ID \
        --branch-name $BRANCH \
        --job-id $JOB_ID; then
        echo -e "${RED}Failed to start Amplify deployment. Exiting...${NC}"
        exit 1
    fi

    echo -e "${GREEN}Frontend deployment completed successfully${NC}"
}

# Main deployment logic
case $DEPLOY_TYPE in
    "backend")
        deploy_backend
        ;;
    "frontend")
        deploy_frontend
        ;;
    "both")
        deploy_backend
        deploy_frontend
        ;;
esac

echo -e "\n${GREEN}Deployment completed successfully!${NC}"
echo -e "\n${GREEN}Application Login page: ${BLUE}$VITE_REDIRECT_SIGN_IN${NC}"
echo -e "\n${GREEN}You should have received an email from no-reply@verificationemail.com with your temporary password!${NC}"