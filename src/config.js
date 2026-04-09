import "@aws-amplify/ui-react/styles.css";

let config = {
  sparkyArn: import.meta.env.VITE_APP_SPARKY || "",
};

const amplifyConfig = {
  Auth: {
    Cognito: {
      loginWith: {
        oauth: {
          domain: import.meta.env.VITE_COGNITO_DOMAIN,
          scopes: ["email", "openid", "profile"],
          redirectSignIn: ["http://localhost:5173", import.meta.env.VITE_REDIRECT_SIGN_IN],
          redirectSignOut: ["http://localhost:5173", import.meta.env.VITE_REDIRECT_SIGN_OUT],
          responseType: "code",
        },
      },
      region: import.meta.env.VITE_COGNITO_REGION,
      userPoolId: import.meta.env.VITE_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_APP_CLIENT_ID,
    },
  },
};
export { config, amplifyConfig };

const parseSparkyModelConfig = () => {
  const raw = import.meta.env.VITE_SPARKY_MODEL_CONFIG;
  if (!raw) return { defaultModelId: null, models: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      defaultModelId: parsed.default_model_id ?? null,
      models: parsed.models ?? [],
    };
  } catch {
    console.error("Failed to parse VITE_SPARKY_MODEL_CONFIG");
    return { defaultModelId: null, models: [] };
  }
};

export const sparkyModelConfig = parseSparkyModelConfig();
