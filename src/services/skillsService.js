/**
 * Skills Service
 *
 * Provides API functions for managing user skills.
 * Uses the Core-Services endpoint for synchronous API operations.
 *
 */

import { getAuthToken } from "../components/Agent/context/utils";
import {
  CORE_SERVICES_ENDPOINT,
  CORE_SERVICES_SESSION_ID,
} from "../components/Agent/context/constants";
import { createSparkySessionHeader } from "../utils/sessionSeed";

/**
 * List all skills for the authenticated user with pagination.
 *
 * @param {number} limit - Maximum number of skills to return (default: 50)
 * @param {Object|null} cursor - Pagination cursor from previous request
 * @returns {Promise<Object>} Object containing skills array, cursor, and has_more flag
 */
export const listSkills = async (limit = 50, cursor = null) => {
  const token = await getAuthToken();

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({
      input: {
        type: "list_skills",
        limit,
        cursor,
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to list skills: ${response.status}`);
  }

  const data = await response.json();
  return {
    system: data.system || [],
    user: data.user || [],
    cursor: data.cursor,
    has_more: data.has_more || false,
  };
};

/**
 * Get a single skill by name including full instruction.
 *
 * @param {string} skillName - The name of the skill to fetch
 * @returns {Promise<Object>} The full skill object
 * @throws {Error} If skill not found or request fails
 */
export const getSkill = async (skillName) => {
  const token = await getAuthToken();

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({
      input: {
        type: "get_skill",
        skill_name: skillName,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    if (data.type === "skill_not_found") {
      const error = new Error(data.error || `Skill '${skillName}' not found`);
      error.type = "skill_not_found";
      throw error;
    }
    throw new Error(data.error || `Failed to get skill: ${response.status}`);
  }

  return data.skill;
};

/**
 * Create a new skill.
 *
 * @param {string} skillName - Unique identifier (alphanumeric, underscores, hyphens, max 50 chars)
 * @param {string} description - Brief summary (max 200 chars)
 * @param {string} instruction - Detailed procedure (max 40000 chars)
 * @param {string} [visibility] - Optional visibility ("public" or "private", defaults to "private")
 * @returns {Promise<Object>} The created skill object
 * @throws {Error} If validation fails or skill already exists
 */
export const createSkill = async (skillName, description, visibility) => {
  const token = await getAuthToken();

  const input = {
    type: "create_skill",
    skill_name: skillName,
    description,
  };
  if (visibility) {
    input.visibility = visibility;
  }

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({ input }),
  });

  const data = await response.json();

  // AgentCore returns errors as 200 with type: "error"
  if (data.type === "error") {
    if (data.error_code === "skill_exists") {
      const error = new Error(data.message || `Skill '${skillName}' already exists`);
      error.type = "skill_exists";
      throw error;
    }
    if (data.error_code === "validation_error") {
      const error = new Error(data.message || "Validation failed");
      error.type = "validation_error";
      error.fields = data.details?.fields || {};
      throw error;
    }
    throw new Error(data.message || `Failed to create skill`);
  }

  if (!response.ok) {
    if (data.type === "skill_exists") {
      const error = new Error(data.error || `Skill '${skillName}' already exists`);
      error.type = "skill_exists";
      throw error;
    }
    if (data.type === "validation_error") {
      const error = new Error(data.error || "Validation failed");
      error.type = "validation_error";
      error.fields = data.fields || {};
      throw error;
    }
    throw new Error(data.error || `Failed to create skill: ${response.status}`);
  }

  return data.skill;
};

/**
 * Update an existing skill.
 *
 * @param {string} skillName - The skill to update
 * @param {string} description - New description (max 200 chars)
 * @param {string} instruction - New instruction (max 40000 chars)
 * @param {string} [visibility] - Optional visibility ("public" or "private")
 * @returns {Promise<Object>} The updated skill object
 * @throws {Error} If validation fails or skill not found
 */
export const updateSkill = async (skillName, description, visibility) => {
  const token = await getAuthToken();

  const input = {
    type: "update_skill",
    skill_name: skillName,
    description,
  };
  if (visibility) {
    input.visibility = visibility;
  }

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({ input }),
  });

  const data = await response.json();

  if (!response.ok) {
    if (data.type === "skill_not_found") {
      const error = new Error(data.error || `Skill '${skillName}' not found`);
      error.type = "skill_not_found";
      throw error;
    }
    if (data.type === "validation_error") {
      const error = new Error(data.error || "Validation failed");
      error.type = "validation_error";
      error.fields = data.fields || {};
      throw error;
    }
    throw new Error(data.error || `Failed to update skill: ${response.status}`);
  }

  return data.skill;
};

/**
 * Delete a skill by name.
 *
 * @param {string} skillName - The name of the skill to delete
 * @returns {Promise<Object>} Success response
 */
export const deleteSkill = async (skillName) => {
  const token = await getAuthToken();

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({
      input: {
        type: "delete_skill",
        skill_name: skillName,
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to delete skill: ${response.status}`);
  }

  return await response.json();
};

/**
 * List all public skills across all users with pagination.
 *
 * @param {number} limit - Maximum number of skills to return (default: 50)
 * @param {Object|null} cursor - Pagination cursor from previous request
 * @returns {Promise<Object>} Object containing skills array, cursor, and has_more flag
 */
export const listPublicSkills = async (limit = 50, cursor = null) => {
  const token = await getAuthToken();

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({
      input: {
        type: "list_public_skills",
        limit,
        cursor,
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to list public skills: ${response.status}`);
  }

  const data = await response.json();
  return {
    skills: data.skills || [],
    cursor: data.cursor,
    has_more: data.has_more || false,
  };
};

/**
 * Get a single public skill by creator user ID and skill name.
 *
 * @param {string} creatorUserId - The user ID of the skill creator
 * @param {string} skillName - The name of the skill to fetch
 * @returns {Promise<Object>} The full skill object
 * @throws {Error} If skill not found or not public
 */
export const getPublicSkill = async (creatorUserId, skillName) => {
  const token = await getAuthToken();

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({
      input: {
        type: "get_public_skill",
        creator_user_id: creatorUserId,
        skill_name: skillName,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    if (data.type === "skill_not_found") {
      const error = new Error(data.error || `Public skill '${skillName}' not found`);
      error.type = "skill_not_found";
      throw error;
    }
    throw new Error(data.error || `Failed to get public skill: ${response.status}`);
  }

  return data.skill;
};

/**
 * Get full skill content including markdown, scripts, and templates from S3.
 *
 * @param {string} skillName - The name of the skill
 * @returns {Promise<Object>} Object with {markdown, scripts, templates}
 */
export const getSkillContent = async (skillName) => {
  const token = await getAuthToken();

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({
      input: {
        type: "get_skill_content",
        skill_name: skillName,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    if (data.type === "skill_not_found") {
      const error = new Error(data.error || `Skill '${skillName}' not found`);
      error.type = "skill_not_found";
      throw error;
    }
    throw new Error(data.error || `Failed to get skill content: ${response.status}`);
  }

  return {
    markdown: data.markdown ?? null,
    scripts: data.scripts ?? [],
    templates: data.templates ?? [],
    references: data.references ?? [],
  };
};

/**
 * Save skill content (SKILL.md or script) to S3 via API.
 *
 * @param {string} skillName - The name of the skill
 * @param {Object} content - Content to save: {filename, content} where filename is "SKILL.md" or a script name
 * @returns {Promise<Object>} Success response
 */
export const saveSkillContent = async (skillName, content) => {
  const token = await getAuthToken();

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({
      input: {
        type: "save_skill_content",
        skill_name: skillName,
        filename: content.filename,
        content: content.content,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    if (data.type === "validation_error") {
      const error = new Error(data.error || "Validation failed");
      error.type = "validation_error";
      throw error;
    }
    if (data.type === "access_denied") {
      const error = new Error(data.error || "System skills are read-only");
      error.type = "access_denied";
      throw error;
    }
    throw new Error(data.error || `Failed to save skill content: ${response.status}`);
  }

  return data;
};

/**
 * Upload a template file to a skill's templates/ subfolder in S3.
 *
 * @param {string} skillName - The name of the skill
 * @param {File} file - The file object to upload
 * @returns {Promise<Object>} Success response
 */
export const uploadTemplate = async (skillName, file) => {
  const token = await getAuthToken();

  // Read file content as base64 for JSON transport
  const arrayBuffer = await file.arrayBuffer();
  const base64Content = btoa(
    new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
  );

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({
      input: {
        type: "upload_template",
        skill_name: skillName,
        filename: file.name,
        content: base64Content,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    if (data.type === "validation_error") {
      const error = new Error(data.error || "Validation failed");
      error.type = "validation_error";
      throw error;
    }
    throw new Error(data.error || `Failed to upload template: ${response.status}`);
  }

  return data;
};

/**
 * Delete a template file from a skill's templates/ subfolder in S3.
 *
 * @param {string} skillName - The name of the skill
 * @param {string} filename - The template filename to delete
 * @returns {Promise<Object>} Success response
 */
export const deleteTemplate = async (skillName, filename) => {
  const token = await getAuthToken();

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({
      input: {
        type: "delete_template",
        skill_name: skillName,
        filename,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    if (data.type === "validation_error") {
      const error = new Error(data.error || "Validation failed");
      error.type = "validation_error";
      throw error;
    }
    throw new Error(data.error || `Failed to delete template: ${response.status}`);
  }

  return data;
};

/**
 * Upload a reference .md file to a skill's references/ subfolder in S3.
 *
 * @param {string} skillName - The name of the skill
 * @param {string} filename - The reference filename (must end with .md)
 * @param {string} content - The text content of the reference file
 * @returns {Promise<Object>} Success response
 */
export const uploadReference = async (skillName, filename, content) => {
  const token = await getAuthToken();

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({
      input: {
        type: "upload_reference",
        skill_name: skillName,
        filename,
        content,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    if (data.type === "validation_error") {
      const error = new Error(data.error || "Validation failed");
      error.type = "validation_error";
      throw error;
    }
    throw new Error(data.error || `Failed to upload reference: ${response.status}`);
  }

  return data;
};

/**
 * Delete a reference file from a skill's references/ subfolder in S3.
 *
 * @param {string} skillName - The name of the skill
 * @param {string} filename - The reference filename to delete
 * @returns {Promise<Object>} Success response
 */
export const deleteReference = async (skillName, filename) => {
  const token = await getAuthToken();

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({
      input: {
        type: "delete_reference",
        skill_name: skillName,
        filename,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    if (data.type === "validation_error") {
      const error = new Error(data.error || "Validation failed");
      error.type = "validation_error";
      throw error;
    }
    throw new Error(data.error || `Failed to delete reference: ${response.status}`);
  }

  return data;
};

/**
 * Delete a script file from a skill.
 *
 * @param {string} skillName - The name of the skill
 * @param {string} filename - The script filename to delete
 * @returns {Promise<Object>} Success response
 */
export const deleteScript = async (skillName, filename) => {
  const token = await getAuthToken();

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({
      input: {
        type: "delete_script",
        skill_name: skillName,
        filename,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    if (data.type === "validation_error") {
      const error = new Error(data.error || "Validation failed");
      error.type = "validation_error";
      throw error;
    }
    throw new Error(data.error || `Failed to delete script: ${response.status}`);
  }

  return data;
};

/**
 * Toggle a skill's enabled/disabled state.
 *
 * @param {string} skillName - The name of the skill to toggle
 * @param {boolean} disabled - Whether the skill should be disabled
 * @returns {Promise<Object>} Success response
 */
export const toggleSkill = async (skillName, disabled) => {
  const token = await getAuthToken();

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({
      input: {
        type: "toggle_skill",
        skill_name: skillName,
        disabled,
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to toggle skill: ${response.status}`);
  }

  return await response.json();
};
