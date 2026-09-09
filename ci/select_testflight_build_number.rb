#!/usr/bin/env ruby
# frozen_string_literal: true

require "base64"
require "json"
require "net/http"
require "openssl"
require "uri"

# Selects the next App Store Connect build number before the expensive archive.
# The requested number is optional; when omitted, the latest uploaded build for
# the exact bundle/version train is read and incremented.
class TestFlightBuildNumberSelector
  API_BASE = "https://api.appstoreconnect.apple.com"
  BUILD_NUMBER_PATTERN = /\A\d+\z/

  class SelectionError < StandardError; end

  def self.validate_build_number!(value, label)
    return if BUILD_NUMBER_PATTERN.match?(value.to_s)

    raise SelectionError, "#{label.capitalize} must contain only digits. Received: #{value}"
  end

  def self.compare_build_numbers(left, right)
    validate_build_number!(left, "left build number")
    validate_build_number!(right, "right build number")
    left.to_i <=> right.to_i
  end

  def self.select_build_number(requested_build_number:, latest_build_number:)
    requested = requested_build_number.to_s.strip
    unless requested.empty?
      validate_build_number!(requested, "requested build number")
      if latest_build_number && compare_build_numbers(requested, latest_build_number) <= 0
        raise SelectionError,
              "Requested build number #{requested} must be greater than latest App Store Connect build #{latest_build_number}."
      end
      return requested
    end

    latest_build_number ? (latest_build_number.to_i + 1).to_s : "1"
  end

  def initialize(env: ENV)
    @env = env
    @jwt_token = nil
  end

  def run
    bundle_id = required_env("BUNDLE_ID")
    marketing_version = required_env("MARKETING_VERSION")
    requested = @env.fetch("REQUESTED_BUILD_NUMBER", "")
    latest = latest_uploaded_build_number(bundle_id: bundle_id, marketing_version: marketing_version)
    selected = self.class.select_build_number(
      requested_build_number: requested,
      latest_build_number: latest
    )

    warn "Latest App Store Connect build for #{bundle_id} #{marketing_version}: #{latest || "none"}"
    warn "Selected build number: #{selected}"
    selected
  end

  private

  def latest_uploaded_build_number(bundle_id:, marketing_version:)
    app_id = app_id_for_bundle_id(bundle_id)
    builds = fetch_paginated_json(
      "/v1/builds",
      "filter[app]" => app_id,
      "filter[preReleaseVersion.version]" => marketing_version,
      "fields[builds]" => "version,uploadedDate",
      "limit" => "200"
    )
    build_numbers = builds.map { |item| item.dig("attributes", "version") }.compact
    invalid = build_numbers.reject { |value| self.class::BUILD_NUMBER_PATTERN.match?(value.to_s) }
    unless invalid.empty?
      raise SelectionError,
            "Cannot auto-select after non-numeric App Store Connect build numbers: #{invalid.uniq.join(", ")}"
    end

    build_numbers.max { |left, right| self.class.compare_build_numbers(left, right) }
  end

  def app_id_for_bundle_id(bundle_id)
    apps = fetch_paginated_json(
      "/v1/apps",
      "filter[bundleId]" => bundle_id,
      "fields[apps]" => "bundleId,name,sku",
      "limit" => "10"
    )
    app = apps.find { |item| item.dig("attributes", "bundleId") == bundle_id }
    raise SelectionError, "No App Store Connect app found for bundle ID #{bundle_id}." unless app

    app.fetch("id")
  end

  def fetch_paginated_json(path, params)
    url = URI.join(API_BASE, path)
    url.query = URI.encode_www_form(params)
    items = []
    loop do
      response = fetch_json(url)
      data = response.fetch("data")
      raise SelectionError, "Expected App Store Connect data array from #{url}." unless data.is_a?(Array)

      items.concat(data)
      next_url = response.dig("links", "next")
      break if next_url.to_s.empty?

      url = URI(next_url)
    end
    items
  end

  def fetch_json(url)
    request = Net::HTTP::Get.new(url)
    request["Authorization"] = "Bearer #{jwt_token}"
    request["Accept"] = "application/json"
    response = Net::HTTP.start(
      url.hostname,
      url.port,
      use_ssl: url.scheme == "https",
      open_timeout: 10,
      read_timeout: 30
    ) { |http| http.request(request) }

    unless response.is_a?(Net::HTTPSuccess)
      raise SelectionError, "App Store Connect request failed with HTTP #{response.code}."
    end

    JSON.parse(response.body)
  rescue JSON::ParserError => error
    raise SelectionError, "App Store Connect returned invalid JSON: #{error.message}"
  end

  def jwt_token
    @jwt_token ||= begin
      now = Time.now.to_i - 60
      header = { alg: "ES256", kid: required_env("APP_STORE_CONNECT_KEY_ID"), typ: "JWT" }
      payload = { iss: required_env("APP_STORE_CONNECT_ISSUER_ID"), iat: now, exp: now + 1_200, aud: "appstoreconnect-v1" }
      signing_input = [base64url(header.to_json), base64url(payload.to_json)].join(".")
      "#{signing_input}.#{base64url(es256_signature(signing_input))}"
    end
  end

  def es256_signature(signing_input)
    key = OpenSSL::PKey.read(File.read(required_env("APP_STORE_CONNECT_KEY_PATH")))
    der_signature = key.sign(OpenSSL::Digest::SHA256.new, signing_input)
    sequence = OpenSSL::ASN1.decode(der_signature)
    r = sequence.value[0].value.to_i
    s = sequence.value[1].value.to_i
    [[r.to_s(16).rjust(64, "0"), s.to_s(16).rjust(64, "0")].join].pack("H*")
  end

  def base64url(value)
    Base64.strict_encode64(value).tr("+/", "-_").delete("=")
  end

  def required_env(name)
    value = @env[name].to_s
    raise SelectionError, "Missing required environment variable: #{name}" if value.empty?

    value
  end
end

if $PROGRAM_NAME == __FILE__
  begin
    puts TestFlightBuildNumberSelector.new.run
  rescue TestFlightBuildNumberSelector::SelectionError => error
    warn error.message
    exit 1
  end
end
