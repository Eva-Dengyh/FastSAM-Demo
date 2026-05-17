package config

import (
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

type WorkerConfig struct {
	ID          string `yaml:"id"`
	URL         string `yaml:"url"`
	MaxInflight int    `yaml:"max_inflight"`
	MaxQueue    int    `yaml:"max_queue"`
}

type HealthConfig struct {
	IntervalSeconds     int `yaml:"interval_seconds"`
	TimeoutSeconds      int `yaml:"timeout_seconds"`
	UnhealthyThreshold  int `yaml:"unhealthy_threshold"`
	HealthyThreshold    int `yaml:"healthy_threshold"`
}

type Config struct {
	Listen                string         `yaml:"listen"`
	APIPrefix             string         `yaml:"api_prefix"`
	Workers               []WorkerConfig `yaml:"workers"`
	RequestTimeoutSeconds int            `yaml:"request_timeout_seconds"`
	SessionTTLSeconds     int            `yaml:"session_ttl_seconds"`
	Health                HealthConfig   `yaml:"health"`
	LogLevel              string         `yaml:"log_level"`
}

func (c *Config) RequestTimeout() time.Duration {
	return time.Duration(c.RequestTimeoutSeconds) * time.Second
}

func (c *Config) SessionTTL() time.Duration {
	return time.Duration(c.SessionTTLSeconds) * time.Second
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse yaml: %w", err)
	}
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func (c *Config) validate() error {
	if c.Listen == "" {
		return fmt.Errorf("listen is empty")
	}
	if len(c.Workers) == 0 {
		return fmt.Errorf("no workers configured")
	}
	seen := make(map[string]bool, len(c.Workers))
	for _, w := range c.Workers {
		if w.ID == "" || w.URL == "" {
			return fmt.Errorf("worker missing id or url: %+v", w)
		}
		if seen[w.ID] {
			return fmt.Errorf("duplicate worker id: %s", w.ID)
		}
		seen[w.ID] = true
		if w.MaxInflight <= 0 {
			return fmt.Errorf("worker %s: max_inflight must be > 0", w.ID)
		}
		if w.MaxQueue <= 0 {
			return fmt.Errorf("worker %s: max_queue must be > 0", w.ID)
		}
	}
	if c.RequestTimeoutSeconds <= 0 {
		c.RequestTimeoutSeconds = 60
	}
	if c.SessionTTLSeconds <= 0 {
		c.SessionTTLSeconds = 3600
	}
	if c.Health.IntervalSeconds <= 0 {
		c.Health.IntervalSeconds = 5
	}
	if c.Health.TimeoutSeconds <= 0 {
		c.Health.TimeoutSeconds = 2
	}
	if c.Health.UnhealthyThreshold <= 0 {
		c.Health.UnhealthyThreshold = 3
	}
	if c.Health.HealthyThreshold <= 0 {
		c.Health.HealthyThreshold = 2
	}
	if c.APIPrefix == "" {
		c.APIPrefix = "/api"
	}
	return nil
}
