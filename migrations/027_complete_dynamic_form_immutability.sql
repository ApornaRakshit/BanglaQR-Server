-- Migration: 027_complete_dynamic_form_immutability.sql
-- Description: Closes all remaining gaps for Published Form Version immutability.
-- Enforces BEFORE INSERT protection on sections, fields, options, and rules,
-- and BEFORE UPDATE/DELETE on options and version metadata.

DELIMITER $$

-- 1. Complete protection on merchant_form_versions (prevent deleting published versions)
DROP TRIGGER IF EXISTS trg_prevent_published_form_version_delete$$
CREATE TRIGGER trg_prevent_published_form_version_delete
BEFORE DELETE ON merchant_form_versions
FOR EACH ROW
BEGIN
  IF OLD.status = 'published' THEN
    SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Immutable Published Form: A published form version cannot be deleted. Archive it or create a new draft instead.';
  END IF;
END$$

-- 2. Section BEFORE INSERT: prevent adding new sections to a published form version
DROP TRIGGER IF EXISTS trg_prevent_published_form_section_insert$$
CREATE TRIGGER trg_prevent_published_form_section_insert
BEFORE INSERT ON merchant_form_sections
FOR EACH ROW
BEGIN
  DECLARE v_status VARCHAR(20);
  SELECT status INTO v_status FROM merchant_form_versions WHERE id = NEW.form_version_id LIMIT 1;
  IF v_status = 'published' THEN
    SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Immutable Published Form: Cannot add new sections to an already published form version.';
  END IF;
END$$

-- 3. Field BEFORE INSERT: prevent adding new fields to a section in a published form version
DROP TRIGGER IF EXISTS trg_prevent_published_form_field_insert$$
CREATE TRIGGER trg_prevent_published_form_field_insert
BEFORE INSERT ON merchant_form_fields
FOR EACH ROW
BEGIN
  DECLARE v_status VARCHAR(20);
  SELECT mfv.status INTO v_status
  FROM merchant_form_versions mfv
  JOIN merchant_form_sections mfs ON mfs.form_version_id = mfv.id
  WHERE mfs.id = NEW.section_id LIMIT 1;
  IF v_status = 'published' THEN
    SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Immutable Published Form: Cannot add new fields to an already published form version.';
  END IF;
END$$

-- 4. Field Options BEFORE INSERT: prevent adding options to a field in a published form
DROP TRIGGER IF EXISTS trg_prevent_published_form_option_insert$$
CREATE TRIGGER trg_prevent_published_form_option_insert
BEFORE INSERT ON merchant_form_field_options
FOR EACH ROW
BEGIN
  DECLARE v_status VARCHAR(20);
  SELECT mfv.status INTO v_status
  FROM merchant_form_versions mfv
  JOIN merchant_form_sections mfs ON mfs.form_version_id = mfv.id
  JOIN merchant_form_fields mff ON mff.section_id = mfs.id
  WHERE mff.id = NEW.field_id LIMIT 1;
  IF v_status = 'published' THEN
    SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Immutable Published Form: Cannot add new options to an already published form version.';
  END IF;
END$$

-- 5. Field Options BEFORE UPDATE: prevent modifying options in a published form
DROP TRIGGER IF EXISTS trg_prevent_published_form_option_update$$
CREATE TRIGGER trg_prevent_published_form_option_update
BEFORE UPDATE ON merchant_form_field_options
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
    SET MESSAGE_TEXT = 'Immutable Published Form: Options belonging to a published form version cannot be modified.';
  END IF;
END$$

-- 6. Field Options BEFORE DELETE: prevent deleting options in a published form
DROP TRIGGER IF EXISTS trg_prevent_published_form_option_delete$$
CREATE TRIGGER trg_prevent_published_form_option_delete
BEFORE DELETE ON merchant_form_field_options
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
    SET MESSAGE_TEXT = 'Immutable Published Form: Options belonging to a published form version cannot be deleted.';
  END IF;
END$$

-- 7. Field Rules BEFORE INSERT: prevent adding rules to a field in a published form
DROP TRIGGER IF EXISTS trg_prevent_published_form_rule_insert$$
CREATE TRIGGER trg_prevent_published_form_rule_insert
BEFORE INSERT ON merchant_form_field_rules
FOR EACH ROW
BEGIN
  DECLARE v_status VARCHAR(20);
  SELECT mfv.status INTO v_status
  FROM merchant_form_versions mfv
  JOIN merchant_form_sections mfs ON mfs.form_version_id = mfv.id
  JOIN merchant_form_fields mff ON mff.section_id = mfs.id
  WHERE mff.id = NEW.field_id LIMIT 1;
  IF v_status = 'published' THEN
    SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Immutable Published Form: Cannot add new rules to an already published form version.';
  END IF;
END$$

DELIMITER ;
