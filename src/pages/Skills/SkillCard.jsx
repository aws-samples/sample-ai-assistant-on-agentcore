/**
 * SkillCard Component
 *
 * Displays a skill with name, description, and last updated date.
 * Provides click handler for edit and delete button.
 *
 */

import React from "react";
import { Trash2, Clock, Globe, User } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Format a date string for display
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date string
 */
function formatDate(dateString) {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateString;
  }
}

/**
 * SkillCard displays a skill summary with edit and delete actions.
 *
 * @param {Object} props
 * @param {Object} props.skill - The skill object
 * @param {string} props.skill.skill_name - The skill name
 * @param {string} props.skill.description - The skill description
 * @param {string} props.skill.updated_at - Last updated timestamp
 * @param {Function} props.onEdit - Callback when card is clicked for edit
 * @param {Function} props.onDelete - Callback when delete button is clicked
 * @param {boolean} props.disabled - Whether interactions are disabled
 */
/**
 * SkillCard displays a skill summary with edit and delete actions.
 *
 * @param {Object} props
 * @param {Object} props.skill - The skill object
 * @param {string} props.skill.skill_name - The skill name
 * @param {string} props.skill.description - The skill description
 * @param {string} props.skill.updated_at - Last updated timestamp
 * @param {string} [props.skill.visibility] - "public" or "private"
 * @param {string} [props.skill.user_id] - Creator user ID (for public skills)
 * @param {Function} props.onEdit - Callback when card is clicked for edit
 * @param {Function} props.onDelete - Callback when delete button is clicked
 * @param {boolean} props.disabled - Whether interactions are disabled
 * @param {boolean} props.isOwner - Whether the current user owns this skill
 */
function SkillCard({ skill, onEdit, onDelete, disabled = false, isOwner = true }) {
  const handleCardClick = (e) => {
    if (e.target.closest(".delete-button")) {
      return;
    }
    if (!isOwner) return;
    if (!disabled && onEdit) {
      onEdit();
    }
  };

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    if (!disabled && onDelete) {
      onDelete();
    }
  };

  const isPublic = skill.visibility === "public";

  return (
    <Card
      className={`skill-card ${!isOwner ? "skill-card-readonly" : ""}`}
      onClick={handleCardClick}
      role={isOwner ? "button" : undefined}
      tabIndex={!isOwner || disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (isOwner && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          handleCardClick(e);
        }
      }}
    >
      <CardHeader className="pb-2">
        <div className="skill-card-header">
          <div className="skill-name-row">
            <CardTitle className="text-base skill-name">{skill.skill_name}</CardTitle>
            {isOwner && isPublic && (
              <span className="public-badge">
                <Globe className="h-3 w-3" />
                Public
              </span>
            )}
          </div>
          {isOwner && (
            <Button
              variant="ghost"
              size="icon"
              className="delete-button"
              onClick={handleDeleteClick}
              disabled={disabled}
              aria-label={`Delete ${skill.skill_name}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        <CardDescription className="skill-description">{skill.description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="skill-meta">
          {!isOwner && skill.user_id && (
            <>
              <User className="h-3 w-3" />
              <span>{skill.user_id}</span>
              <span className="meta-separator">·</span>
            </>
          )}
          <Clock className="h-3 w-3" />
          <span>Updated {formatDate(skill.updated_at)}</span>
        </div>
      </CardContent>

      <style jsx>{`
        .skill-card {
          cursor: pointer;
          transition:
            box-shadow 0.2s ease,
            border-color 0.2s ease;
        }

        .skill-card:hover {
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          border-color: var(--color-primary);
        }

        .skill-card:focus {
          outline: none;
          box-shadow: 0 0 0 2px var(--color-ring);
        }

        .skill-card-readonly {
          cursor: default;
        }

        .skill-card-readonly:hover {
          box-shadow: none;
          border-color: var(--color-border);
        }

        .skill-card-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 0.5rem;
        }

        .skill-name-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex: 1;
          min-width: 0;
        }

        .skill-name {
          word-break: break-word;
        }

        .public-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.125rem 0.5rem;
          font-size: 0.6875rem;
          font-weight: 500;
          color: var(--color-primary);
          background-color: var(--color-primary-foreground, rgba(99, 102, 241, 0.1));
          border-radius: 9999px;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .skill-description {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .delete-button {
          flex-shrink: 0;
          color: var(--color-muted-foreground);
          opacity: 0;
          transition:
            opacity 0.2s ease,
            color 0.2s ease;
        }

        .skill-card:hover .delete-button {
          opacity: 1;
        }

        .delete-button:hover {
          color: var(--color-destructive, #ef4444);
          background: rgba(239, 68, 68, 0.15);
          border-radius: 4px;
        }

        .skill-meta {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.75rem;
          color: var(--color-muted-foreground);
        }

        .meta-separator {
          margin: 0 0.125rem;
        }
      `}</style>
    </Card>
  );
}

export default SkillCard;
