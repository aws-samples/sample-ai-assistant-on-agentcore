import React, { useState } from "react";
import { signIn, confirmSignIn, resetPassword, confirmResetPassword } from "aws-amplify/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useTheme } from "../ThemeContext";
import "./LoginForm.css";

const FormField = ({ label, htmlFor, children }) => (
  <div className="grid w-full gap-1.5 text-left">
    <Label htmlFor={htmlFor}>{label}</Label>
    {children}
  </div>
);

const FormTitle = ({ children }) => (
  <h1 className="text-2xl font-light mb-10 text-foreground">{children}</h1>
);

const LoginForm = ({ onSignInSuccess }) => {
  const { isDark } = useTheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [formState, setFormState] = useState("signIn");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [passwordValidation, setPasswordValidation] = useState({
    isValid: false,
    requirements: {
      minLength: false,
      hasUpperCase: false,
      hasLowerCase: false,
      hasNumber: false,
      hasSpecialChar: false,
    },
  });

  const validatePassword = (pwd) => {
    const requirements = {
      minLength: pwd.length >= 8,
      hasUpperCase: /[A-Z]/.test(pwd),
      hasLowerCase: /[a-z]/.test(pwd),
      hasNumber: /\d/.test(pwd),
      hasSpecialChar: /[!@#$%^&*(),.?":{}|<>]/.test(pwd),
    };
    return {
      isValid: Object.values(requirements).every(Boolean),
      requirements,
    };
  };

  const handlePasswordChange = (e) => {
    const pwd = e.target.value;
    setNewPassword(pwd);
    setPasswordValidation(validatePassword(pwd));
  };

  const handleSignIn = async (e) => {
    setLoading(true);
    e.preventDefault();
    setError("");
    try {
      const { isSignedIn, nextStep } = await signIn({ username, password });
      if (nextStep?.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
        setFormState("newPassword");
      } else if (isSignedIn) {
        onSignInSuccess?.();
      }
    } catch (err) {
      setError(err.message || "Error signing in");
    } finally {
      setLoading(false);
    }
  };

  const handleNewPassword = async (e) => {
    setLoading(true);
    e.preventDefault();
    setError("");
    try {
      const { isSignedIn } = await confirmSignIn({ challengeResponse: newPassword });
      if (isSignedIn) {
        onSignInSuccess?.();
      }
    } catch (err) {
      setError(err.message || "Error setting new password");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    setLoading(true);
    e.preventDefault();
    setError("");
    try {
      await resetPassword({ username });
      setConfirmNewPassword("");
      setNewPassword("");
      setFormState("resetPassword");
    } catch (err) {
      setError(err.message || "Error initiating password reset");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmNewPassword) {
      setError("Passwords do not match");
      return;
    }
    if (!passwordValidation.isValid) {
      setError("Password does not meet requirements");
      return;
    }
    setLoading(true);
    try {
      await confirmResetPassword({ username, confirmationCode, newPassword });
      setFormState("signIn");
    } catch (err) {
      setError(err.message || "Error resetting password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`login-container ${isDark ? "dark" : ""}`}>
      {formState === "signIn" && (
        <div className="form-container">
          <div style={{ width: 64, height: 64, marginBottom: 8 }}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="none"
              width="64"
              height="64"
            >
              <defs>
                <radialGradient
                  id="loginSparkleGradient"
                  cx="30%"
                  cy="30%"
                  r="70%"
                  gradientUnits="objectBoundingBox"
                >
                  <stop offset="0" stopColor="#B8E7FF" stopOpacity="1" />
                  <stop offset="0.15" stopColor="#0099FF" stopOpacity="1" />
                  <stop offset="0.3" stopColor="#5C7FFF" stopOpacity="1" />
                  <stop offset="0.45" stopColor="#8575FF" stopOpacity="1" />
                  <stop offset="0.6" stopColor="#962EFF" stopOpacity="1" />
                  <stop offset="1" stopColor="#962EFF" stopOpacity="1" />
                </radialGradient>
              </defs>
              <path
                d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .963L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
                fill="url(#loginSparkleGradient)"
              />
            </svg>
          </div>
          <FormTitle>Welcome back</FormTitle>
          {error && <div className="error-message">{error}</div>}
          <form onSubmit={handleSignIn} className="w-[85%] space-y-4">
            <FormField label="Username" htmlFor="username">
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="h-10 bg-background"
              />
            </FormField>
            <FormField label="Password" htmlFor="password">
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-10 bg-background"
              />
            </FormField>
            <div className="text-right -mt-2">
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setFormState("forgotPassword");
                }}
                className="text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors"
              >
                Forgot Password?
              </a>
            </div>
            <div className="pt-4">
              <Button type="submit" className="w-full h-10" disabled={loading}>
                {loading ? <Spinner size="sm" /> : "Sign In"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {formState === "newPassword" && (
        <div className="form-container">
          <FormTitle>Set New Password</FormTitle>
          {error && <div className="error-message">{error}</div>}
          <form onSubmit={handleNewPassword} className="w-[85%] space-y-4">
            <FormField label="New Password" htmlFor="newPassword">
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={handlePasswordChange}
                required
                className="h-10 bg-background"
              />
            </FormField>
            <div className="pt-4">
              <Button
                type="submit"
                className="w-full h-10"
                disabled={loading || !passwordValidation.isValid}
              >
                {loading ? <Spinner size="sm" /> : "Set New Password"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {formState === "forgotPassword" && (
        <div className="form-container">
          <FormTitle>Reset Password</FormTitle>
          {error && <div className="error-message">{error}</div>}
          <form onSubmit={handleForgotPassword} className="w-[85%] space-y-4">
            <FormField label="Username" htmlFor="forgotUsername">
              <Input
                id="forgotUsername"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="h-10 bg-background"
              />
            </FormField>
            <div className="pt-4">
              <Button type="submit" className="w-full h-10" disabled={loading}>
                {loading ? <Spinner size="sm" /> : "Send Reset Code"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {formState === "resetPassword" && (
        <div className="form-container">
          <FormTitle>Reset Password</FormTitle>
          {error && <div className="error-message">{error}</div>}
          <form onSubmit={handleResetPassword} className="w-[85%] space-y-4">
            <FormField label="Confirmation Code" htmlFor="confirmationCode">
              <Input
                id="confirmationCode"
                type="text"
                value={confirmationCode}
                onChange={(e) => setConfirmationCode(e.target.value)}
                required
                className="h-10 bg-background"
              />
            </FormField>
            <FormField label="New Password" htmlFor="resetNewPassword">
              <Input
                id="resetNewPassword"
                type="password"
                value={newPassword}
                onChange={handlePasswordChange}
                required
                className="h-10 bg-background"
              />
            </FormField>
            <FormField label="Confirm New Password" htmlFor="confirmNewPassword">
              <Input
                id="confirmNewPassword"
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                required
                className="h-10 bg-background"
              />
            </FormField>
            <div className="pt-4">
              <Button
                type="submit"
                className="w-full h-10"
                disabled={
                  loading ||
                  !passwordValidation.isValid ||
                  !confirmationCode ||
                  newPassword !== confirmNewPassword
                }
              >
                {loading ? <Spinner size="sm" /> : "Reset Password"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default LoginForm;
