/**
 * SkillFormDialog Component
 *
 * Dialog for creating or editing skills with form validation.
 * Supports both create and edit modes.
 *
 */

import React, { useState, useCallback, useEffect } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// Validation constraints from requirements
const MAX_NAME_LENGTH = 50;
const MAX_DESCRIPTION_LENGTH = 200;
const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * SkillFormDialog provides a form for creating or editing skills.
 *
 * @param {Object} props
 * @param {boolean} props.open - Whether the dialog is open
 * @param {Function} props.onOpenChange - Callback when open state changes
 * @param {Object|null} props.skill - Existing skill for edit mode, null for create
 * @param {Function} props.onSubmit - Callback when form is submitted
 * @param {boolean} props.disabled - Whether interactions are disabled
 */
function SkillFormDialog({ open, onOpenChange, skill = null, onSubmit, disabled = false }) {
  const isEditMode = skill !== null;

  const [formData, setFormData] = useState({
    skill_name: "",
    description: "",
    visibility: "private",
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  /**
   * Initialize form data when skill changes or dialog opens
   */
  useEffect(() => {
    if (open) {
      if (skill) {
        setFormData({
          skill_name: skill.skill_name || "",
          description: skill.description || "",
          visibility: skill.visibility || "private",
        });
      } else {
        setFormData({
          skill_name: "",
          description: "",
          visibility: "private",
        });
      }
      setErrors({});
      setSubmitError(null);
    }
  }, [open, skill]);

  /**
   * Reset form state
   */
  const resetForm = useCallback(() => {
    setFormData({
      skill_name: "",
      description: "",
      visibility: "private",
    });
    setErrors({});
    setSubmitError(null);
  }, []);

  /**
   * Handle dialog open change
   */
  const handleOpenChange = useCallback(
    (newOpen) => {
      if (!newOpen) {
        resetForm();
      }
      onOpenChange(newOpen);
    },
    [onOpenChange, resetForm]
  );

  /**
   * Handle form field change
   */
  const handleChange = useCallback(
    (field, value) => {
      setFormData((prev) => ({
        ...prev,
        [field]: value,
      }));
      // Clear field error when user types
      if (errors[field]) {
        setErrors((prev) => ({
          ...prev,
          [field]: null,
        }));
      }
      setSubmitError(null);
    },
    [errors]
  );

  /**
   * Validate form data
   */
  const validateForm = useCallback(() => {
    const newErrors = {};

    // Validate skill_name
    const trimmedName = formData.skill_name.trim();
    if (!trimmedName) {
      newErrors.skill_name = "Skill name is required";
    } else if (trimmedName.length > MAX_NAME_LENGTH) {
      newErrors.skill_name = `Name must be ${MAX_NAME_LENGTH} characters or less`;
    } else if (!NAME_PATTERN.test(trimmedName)) {
      newErrors.skill_name = "Name can only contain letters, numbers, hyphens, and underscores";
    }

    // Validate description
    const trimmedDescription = formData.description.trim();
    if (!trimmedDescription) {
      newErrors.description = "Description is required";
    } else if (trimmedDescription.length > MAX_DESCRIPTION_LENGTH) {
      newErrors.description = `Description must be ${MAX_DESCRIPTION_LENGTH} characters or less`;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  /**
   * Handle form submission
   */
  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();

      if (!validateForm()) {
        return;
      }

      setSubmitting(true);
      setSubmitError(null);

      try {
        await onSubmit({
          skill_name: formData.skill_name.trim(),
          description: formData.description.trim(),
        });
        resetForm();
      } catch (err) {
        // Handle validation errors from API
        if (err.type === "validation_error" && err.fields) {
          setErrors(err.fields);
        } else if (err.type === "skill_exists") {
          setErrors({ skill_name: "A skill with this name already exists" });
        } else {
          setSubmitError(err.message || "Failed to save skill");
        }
      } finally {
        setSubmitting(false);
      }
    },
    [formData, validateForm, onSubmit, resetForm]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[800px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditMode ? "Edit Skill" : "Add Skill"}</DialogTitle>
            <DialogDescription>
              {isEditMode
                ? "Update the skill details below."
                : "Create a new skill that the AI can reference and execute."}
            </DialogDescription>
          </DialogHeader>

          <div className="skill-form">
            {/* Skill Name */}
            <div className="form-field">
              <Label htmlFor="skill-name">
                Name <span className="required">*</span>
              </Label>
              <Input
                id="skill-name"
                value={formData.skill_name}
                onChange={(e) => handleChange("skill_name", e.target.value)}
                placeholder="my_skill_name"
                disabled={disabled || submitting || isEditMode}
                className={errors.skill_name ? "input-error" : ""}
                maxLength={MAX_NAME_LENGTH}
              />
              <div className="field-footer">
                {errors.skill_name ? (
                  <p className="field-error">{errors.skill_name}</p>
                ) : (
                  <p className="field-hint">Letters, numbers, hyphens, and underscores only</p>
                )}
                <span className="char-count">
                  {formData.skill_name.length}/{MAX_NAME_LENGTH}
                </span>
              </div>
            </div>

            {/* Description */}
            <div className="form-field">
              <Label htmlFor="skill-description">
                Description <span className="required">*</span>
              </Label>
              <Input
                id="skill-description"
                value={formData.description}
                onChange={(e) => handleChange("description", e.target.value)}
                placeholder="Brief summary of what this skill does"
                disabled={disabled || submitting}
                className={errors.description ? "input-error" : ""}
                maxLength={MAX_DESCRIPTION_LENGTH}
              />
              <div className="field-footer">
                {errors.description ? (
                  <p className="field-error">{errors.description}</p>
                ) : (
                  <p className="field-hint">Shown in the AI's system prompt</p>
                )}
                <span className="char-count">
                  {formData.description.length}/{MAX_DESCRIPTION_LENGTH}
                </span>
              </div>
            </div>

            {/* Submit Error */}
            {submitError && (
              <div className="submit-error">
                <AlertCircle className="h-4 w-4" />
                <span>{submitError}</span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={disabled || submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {submitting ? "Saving" : isEditMode ? "Save Changes" : "Create Skill"}
            </Button>
          </DialogFooter>
        </form>

        <style jsx>{`
          .skill-form {
            display: flex;
            flex-direction: column;
            gap: 1rem;
            padding: 1rem 0;
          }

          .form-field {
            display: flex;
            flex-direction: column;
            gap: 0.375rem;
          }

          .form-field label {
            font-size: 0.875rem;
            font-weight: 500;
          }

          .required {
            color: var(--color-destructive, #ef4444);
          }

          .input-error {
            border-color: var(--color-destructive, #ef4444) !important;
          }

          .field-footer {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 0.5rem;
          }

          .field-error {
            font-size: 0.75rem;
            color: var(--color-destructive, #ef4444);
            margin: 0;
            flex: 1;
          }

          .field-hint {
            font-size: 0.75rem;
            color: var(--color-muted-foreground);
            margin: 0;
            flex: 1;
          }

          .char-count {
            font-size: 0.75rem;
            color: var(--color-muted-foreground);
            flex-shrink: 0;
          }

          .submit-error {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.75rem;
            border-radius: 8px;
            background-color: var(--color-destructive-foreground, #fef2f2);
            color: var(--color-destructive, #ef4444);
            font-size: 0.875rem;
          }
        `}</style>
      </DialogContent>
    </Dialog>
  );
}

export default SkillFormDialog;
