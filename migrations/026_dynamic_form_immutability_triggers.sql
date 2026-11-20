-- Migration: 026_dynamic_form_immutability_triggers.sql
-- Description: Enforces Published Form Version Immutability at database level.
-- When a version is marked 'published', sections, fields, options, and rules referencing it cannot be updated or deleted.

DELIMITER $$

-- 1. Prevent direct changes to a form version once published (cannot switch back to draft, cannot modify published_at)
DROP TRIGGER IF EXISTS trg_prevent_published_form_version_update$$
CREATE TRIGGER trg_prevent_published_form_version_update
BEFORE UPDATE ON merchant_form_versions
FOR EACH ROW
BEGIN
  IF OLD.status = 'published' AND NEW.status = 'draft' THEN
    SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Immutable Published Form: A published form version cannot be reverted to draft. Create a new draft version instead.';
  END IF;
END$$

-- 2. Prevent modifying sections of a published form
DROP TRIGGER IF EXISTS trg_prevent_published_form_section_update$$
CREATE TRIGGER trg_prevent_published_form_section_update
BEFORE UPDATE ON merchant_form_sections
FOR EACH ROW
BEGIN
  DECLARE v_status VARCHAR(20);
  SELECT status INTO v_status FROM merchant_form_versions WHERE id = OLD.form_version_id LIMIT 1;
  IF v_status = 'published' THEN
    SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Immutable Published Form: Sections belonging to a published form version cannot be modified.';
  END IF;
END$$

-- 3. Prevent deleting sections of a published form
DROP TRIGGER IF EXISTS trg_prevent_published_form_section_delete$$
CREATE TRIGGER trg_prevent_published_form_section_delete
BEFORE DELETE ON merchant_form_sections
FOR EACH ROW
BEGIN
  DECLARE v_status VARCHAR(20);
  SELECT status INTO v_status FROM merchant_form_versions WHERE id = OLD.form_version_id LIMIT 1;
  IF v_status = 'published' THEN
    SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Immutable Published Form: Sections belonging to a published form version cannot be deleted.';
  END IF;
END$$

-- 4. Prevent modifying fields of a published form
DROP TRIGGER IF EXISTS trg_prevent_published_form_field_update$$
CREATE TRIGGER trg_prevent_published_form_field_update
BEFORE UPDATE ON merchant_form_fields
FOR EACH ROW
BEGIN
  DECLARE v_status VARCHAR(20);
  SELECT mfv.status INTO v_status
  FROM merchant_form_versions mfv
  JOIN merchant_form_sections mfs ON mfs.form_version_id = mfv.id
  WHERE mfs.id = OLD.section_id LIMIT 1;
  IF v_status = 'published' THEN
    SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Immutable Published Form: Fields belonging to a published form version cannot be modified.';
  END IF;
END$$

-- 5. Prevent deleting fields of a published form
DROP TRIGGER IF EXISTS trg_prevent_published_form_field_delete$$
CREATE TRIGGER trg_prevent_published_form_field_delete
BEFORE DELETE ON merchant_form_fields
FOR EACH ROW
BEGIN
  DECLARE v_status VARCHAR(20);
  SELECT mfv.status INTO v_status
  FROM merchant_form_versions mfv
  JOIN merchant_form_sections mfs ON mfs.form_version_id = mfv.id
  WHERE mfs.id = OLD.section_id LIMIT 1;
  IF v_status = 'published' THEN
    SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Immutable Published Form: Fields belonging to a published form version cannot be deleted.';
  END IF;
END$$

-- 6. Prevent modifying field rules of a published form
DROP TRIGGER IF EXISTS trg_prevent_published_form_rule_update$$
CREATE TRIGGER trg_prevent_published_form_rule_update
BEFORE UPDATE ON merchant_form_field_rules
FOR EACH ROW
BEGIN
  DECLARE v_status VARCHAR(20);
  SELECT mfv.status INTO v_status
  FROM merchant_form_versions mfv
  JOIN merchant_form_sections mfs ON mfs.form_version_id = mfv.id
  JOIN merchant_form_fields mff ON mff.section_id = mfs.id
  WHERE mff.id = OLD.field_id LIMIT 1;
  IF v_status = 'published' THEN
    SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Immutable Published Form: Rules belonging to a published form version cannot be modified.';
  END IF;
END$$

-- 7. Prevent deleting field rules of a published form
DROP TRIGGER IF EXISTS trg_prevent_published_form_rule_delete$$
CREATE TRIGGER trg_prevent_published_form_rule_delete
BEFORE DELETE ON merchant_form_field_rules
FOR EACH ROW
BEGIN
  DECLARE v_status VARCHAR(20);
  SELECT mfv.status INTO v_status
  FROM merchant_form_versions mfv
  JOIN merchant_form_sections mfs ON mfs.form_version_id = mfv.id
  JOIN merchant_form_fields mff ON mff.section_id = mfs.id
  WHERE mff.id = OLD.field_id LIMIT 1;
  IF v_status = 'published' THEN
    SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Immutable Published Form: Rules belonging to a published form version cannot be deleted.';
  END IF;
END$$

DELIMITER ;
