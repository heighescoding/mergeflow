-- Store AI reasoning and observed sample values separately from enforced allowed values
ALTER TABLE destination_fields
  ADD COLUMN suggestion_reasoning TEXT,
  ADD COLUMN observed_sample_values TEXT[];
