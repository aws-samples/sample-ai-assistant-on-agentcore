import React, { useState, useEffect } from "react";
import styled from "@emotion/styled";
import { amplifyConfig } from "../../config";
import { getCurrentUser } from "aws-amplify/auth";
import { Amplify } from "aws-amplify";
import LoginForm from "../../components/Auth/LoginForm";
import { useNavigate } from "react-router";
import { useTheme } from "../../components/ThemeContext";

Amplify.configure(amplifyConfig);

const LoginPageContainer = styled.div`
  width: 100vw;
  height: 100vh;
  background: linear-gradient(
    135deg,
    #962eff 0%,
    #962eff 30%,
    #8575ff 60%,
    #5c7fff 85%,
    #0099ff 100%
  );
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0;
  overflow: hidden;
`;

const LoginCard = styled.div`
  width: 420px;
  max-width: 90vw;
  border-radius: 20px;
  box-shadow: ${(props) =>
    props.isDark
      ? `0 4px 12px rgba(0, 0, 0, 0.4),
       0 8px 32px rgba(0, 0, 0, 0.3),
       0 16px 64px rgba(0, 0, 0, 0.2)`
      : `0 4px 12px rgba(0, 0, 0, 0.12),
       0 8px 32px rgba(0, 0, 0, 0.08),
       0 16px 64px rgba(0, 0, 0, 0.04)`};
  background: ${(props) => (props.isDark ? "#171717" : "#ffffff")};
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
  overflow: hidden;
`;

const LoginPageInternal = ({ setAuthUser }) => {
  const { isDark } = useTheme();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const user = await getCurrentUser();
      setIsAuthenticated(!!user);
      setAuthUser(user);
    } catch (error) {
      setIsAuthenticated(false);
    }
  };

  const handleSignInSuccess = () => {
    setIsAuthenticated(true);
    checkAuthStatus();
  };

  return (
    <LoginPageContainer isDark={isDark}>
      <LoginCard isDark={isDark}>
        <LoginForm onSignInSuccess={handleSignInSuccess} />
      </LoginCard>
    </LoginPageContainer>
  );
};

export default LoginPageInternal;
