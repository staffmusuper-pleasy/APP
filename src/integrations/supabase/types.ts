export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      bookmakers: {
        Row: {
          active: boolean
          country: string | null
          created_at: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          country?: string | null
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          country?: string | null
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      closing_odds: {
        Row: {
          bookmaker_id: string
          captured_at: string
          id: string
          market: string
          match_id: string
          price: number
          selection: string
        }
        Insert: {
          bookmaker_id: string
          captured_at?: string
          id?: string
          market: string
          match_id: string
          price: number
          selection: string
        }
        Update: {
          bookmaker_id?: string
          captured_at?: string
          id?: string
          market?: string
          match_id?: string
          price?: number
          selection?: string
        }
        Relationships: [
          {
            foreignKeyName: "closing_odds_bookmaker_id_fkey"
            columns: ["bookmaker_id"]
            isOneToOne: false
            referencedRelation: "bookmakers"
            referencedColumns: ["id"]
          },
        ]
      }
      data_sources: {
        Row: {
          active: boolean
          created_at: string
          id: string
          last_sync: string | null
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          last_sync?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          last_sync?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      import_logs: {
        Row: {
          competition: string | null
          completed_at: string | null
          created_at: string
          error_sample: string | null
          errors_count: number
          id: string
          matches_imported: number
          matches_updated: number
          source: string
          started_at: string
          status: string
        }
        Insert: {
          competition?: string | null
          completed_at?: string | null
          created_at?: string
          error_sample?: string | null
          errors_count?: number
          id?: string
          matches_imported?: number
          matches_updated?: number
          source: string
          started_at?: string
          status?: string
        }
        Update: {
          competition?: string | null
          completed_at?: string | null
          created_at?: string
          error_sample?: string | null
          errors_count?: number
          id?: string
          matches_imported?: number
          matches_updated?: number
          source?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      league_aliases: {
        Row: {
          alias: string
          created_at: string
          id: string
          league_id: string
          normalized_alias: string
          source: string
        }
        Insert: {
          alias: string
          created_at?: string
          id?: string
          league_id: string
          normalized_alias: string
          source: string
        }
        Update: {
          alias?: string
          created_at?: string
          id?: string
          league_id?: string
          normalized_alias?: string
          source?: string
        }
        Relationships: []
      }
      league_sources: {
        Row: {
          api_calls_saved: number
          consecutive_failures: number
          country: string
          created_at: string
          enabled: boolean
          id: string
          last_attempt_at: string | null
          last_match_imported: string | null
          last_result: string | null
          last_status: string | null
          last_successful_sync: string | null
          league_key: string
          league_name: string
          next_retry_at: string | null
          priority: number
          season_completed: boolean
          source: string
          source_ref: Json
          total_matches_stored: number
          updated_at: string
        }
        Insert: {
          api_calls_saved?: number
          consecutive_failures?: number
          country: string
          created_at?: string
          enabled?: boolean
          id?: string
          last_attempt_at?: string | null
          last_match_imported?: string | null
          last_result?: string | null
          last_status?: string | null
          last_successful_sync?: string | null
          league_key: string
          league_name: string
          next_retry_at?: string | null
          priority?: number
          season_completed?: boolean
          source: string
          source_ref?: Json
          total_matches_stored?: number
          updated_at?: string
        }
        Update: {
          api_calls_saved?: number
          consecutive_failures?: number
          country?: string
          created_at?: string
          enabled?: boolean
          id?: string
          last_attempt_at?: string | null
          last_match_imported?: string | null
          last_result?: string | null
          last_status?: string | null
          last_successful_sync?: string | null
          league_key?: string
          league_name?: string
          next_retry_at?: string | null
          priority?: number
          season_completed?: boolean
          source?: string
          source_ref?: Json
          total_matches_stored?: number
          updated_at?: string
        }
        Relationships: []
      }
      leagues: {
        Row: {
          active: boolean
          api_football_id: number | null
          canonical_key: string | null
          country: string
          created_at: string
          fbref_id: string | null
          fbref_slug: string | null
          id: string
          name: string
          normalized_name: string | null
          season: string
          sofascore_id: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          api_football_id?: number | null
          canonical_key?: string | null
          country: string
          created_at?: string
          fbref_id?: string | null
          fbref_slug?: string | null
          id?: string
          name: string
          normalized_name?: string | null
          season: string
          sofascore_id?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          api_football_id?: number | null
          canonical_key?: string | null
          country?: string
          created_at?: string
          fbref_id?: string | null
          fbref_slug?: string | null
          id?: string
          name?: string
          normalized_name?: string | null
          season?: string
          sofascore_id?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      match_provider_ids: {
        Row: {
          created_at: string
          id: string
          match_id: string
          provider: string
          provider_match_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          match_id: string
          provider: string
          provider_match_id: string
        }
        Update: {
          created_at?: string
          id?: string
          match_id?: string
          provider?: string
          provider_match_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_provider_ids_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_analytics"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "match_provider_ids_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_provider_ids_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "team_upcoming_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_provider_ids_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "upcoming_matches"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          away_cards: number | null
          away_corners: number | null
          away_goals: number | null
          away_possession: number | null
          away_red: number | null
          away_shots: number | null
          away_team_id: string
          away_yellow: number | null
          created_at: string
          home_cards: number | null
          home_corners: number | null
          home_goals: number | null
          home_possession: number | null
          home_red: number | null
          home_shots: number | null
          home_team_id: string
          home_yellow: number | null
          ht_away_goals: number | null
          ht_home_goals: number | null
          id: string
          league_id: string
          match_date: string
          raw_payload: Json | null
          round: string | null
          season: string
          source: string | null
          status: Database["public"]["Enums"]["match_status"]
          updated_at: string
        }
        Insert: {
          away_cards?: number | null
          away_corners?: number | null
          away_goals?: number | null
          away_possession?: number | null
          away_red?: number | null
          away_shots?: number | null
          away_team_id: string
          away_yellow?: number | null
          created_at?: string
          home_cards?: number | null
          home_corners?: number | null
          home_goals?: number | null
          home_possession?: number | null
          home_red?: number | null
          home_shots?: number | null
          home_team_id: string
          home_yellow?: number | null
          ht_away_goals?: number | null
          ht_home_goals?: number | null
          id?: string
          league_id: string
          match_date: string
          raw_payload?: Json | null
          round?: string | null
          season: string
          source?: string | null
          status?: Database["public"]["Enums"]["match_status"]
          updated_at?: string
        }
        Update: {
          away_cards?: number | null
          away_corners?: number | null
          away_goals?: number | null
          away_possession?: number | null
          away_red?: number | null
          away_shots?: number | null
          away_team_id?: string
          away_yellow?: number | null
          created_at?: string
          home_cards?: number | null
          home_corners?: number | null
          home_goals?: number | null
          home_possession?: number | null
          home_red?: number | null
          home_shots?: number | null
          home_team_id?: string
          home_yellow?: number | null
          ht_away_goals?: number | null
          ht_home_goals?: number | null
          id?: string
          league_id?: string
          match_date?: string
          raw_payload?: Json | null
          round?: string | null
          season?: string
          source?: string | null
          status?: Database["public"]["Enums"]["match_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matches_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "competition_coverage"
            referencedColumns: ["league_id"]
          },
          {
            foreignKeyName: "matches_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      odds_history: {
        Row: {
          bookmaker_id: string
          captured_at: string
          id: string
          market: string
          match_id: string
          price: number
          selection: string
        }
        Insert: {
          bookmaker_id: string
          captured_at?: string
          id?: string
          market: string
          match_id: string
          price: number
          selection: string
        }
        Update: {
          bookmaker_id?: string
          captured_at?: string
          id?: string
          market?: string
          match_id?: string
          price?: number
          selection?: string
        }
        Relationships: [
          {
            foreignKeyName: "odds_history_bookmaker_id_fkey"
            columns: ["bookmaker_id"]
            isOneToOne: false
            referencedRelation: "bookmakers"
            referencedColumns: ["id"]
          },
        ]
      }
      opening_odds: {
        Row: {
          bookmaker_id: string
          captured_at: string
          id: string
          market: string
          match_id: string
          price: number
          selection: string
        }
        Insert: {
          bookmaker_id: string
          captured_at?: string
          id?: string
          market: string
          match_id: string
          price: number
          selection: string
        }
        Update: {
          bookmaker_id?: string
          captured_at?: string
          id?: string
          market?: string
          match_id?: string
          price?: number
          selection?: string
        }
        Relationships: [
          {
            foreignKeyName: "opening_odds_bookmaker_id_fkey"
            columns: ["bookmaker_id"]
            isOneToOne: false
            referencedRelation: "bookmakers"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_logs: {
        Row: {
          cards_count: number | null
          cards_found: boolean | null
          cards_written: boolean | null
          corners_count: number | null
          corners_found: boolean | null
          corners_written: boolean | null
          created_at: string
          error_message: string | null
          id: string
          job_run_id: string | null
          league_id: string | null
          match_date: string | null
          match_id: string | null
          payload: Json | null
          provider: string
          provider_attempt_order: number | null
          provider_fixture_id: string | null
          provider_response_time_ms: number | null
          provider_success: boolean | null
          status: string
        }
        Insert: {
          cards_count?: number | null
          cards_found?: boolean | null
          cards_written?: boolean | null
          corners_count?: number | null
          corners_found?: boolean | null
          corners_written?: boolean | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_run_id?: string | null
          league_id?: string | null
          match_date?: string | null
          match_id?: string | null
          payload?: Json | null
          provider: string
          provider_attempt_order?: number | null
          provider_fixture_id?: string | null
          provider_response_time_ms?: number | null
          provider_success?: boolean | null
          status: string
        }
        Update: {
          cards_count?: number | null
          cards_found?: boolean | null
          cards_written?: boolean | null
          corners_count?: number | null
          corners_found?: boolean | null
          corners_written?: boolean | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_run_id?: string | null
          league_id?: string | null
          match_date?: string | null
          match_id?: string | null
          payload?: Json | null
          provider?: string
          provider_attempt_order?: number | null
          provider_fixture_id?: string | null
          provider_response_time_ms?: number | null
          provider_success?: boolean | null
          status?: string
        }
        Relationships: []
      }
      season_guard_log: {
        Row: {
          action: string
          away_team_id: string | null
          declared_season: string | null
          home_team_id: string | null
          id: string
          match_date: string | null
          match_year: number | null
          occurred_at: string
          original_league_id: string | null
          reason: string | null
          resolved_league_id: string | null
          source: string | null
        }
        Insert: {
          action: string
          away_team_id?: string | null
          declared_season?: string | null
          home_team_id?: string | null
          id?: string
          match_date?: string | null
          match_year?: number | null
          occurred_at?: string
          original_league_id?: string | null
          reason?: string | null
          resolved_league_id?: string | null
          source?: string | null
        }
        Update: {
          action?: string
          away_team_id?: string | null
          declared_season?: string | null
          home_team_id?: string | null
          id?: string
          match_date?: string | null
          match_year?: number | null
          occurred_at?: string
          original_league_id?: string | null
          reason?: string | null
          resolved_league_id?: string | null
          source?: string | null
        }
        Relationships: []
      }
      source_priorities: {
        Row: {
          enabled: boolean
          priority: number
          source: string
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          priority: number
          source: string
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          priority?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      statistics_cache: {
        Row: {
          category: Database["public"]["Enums"]["stat_category"]
          created_at: string
          id: string
          league_id: string
          sample_size: number
          statistics: Json
          team_id: string
          updated_at: string
          venue: string
        }
        Insert: {
          category: Database["public"]["Enums"]["stat_category"]
          created_at?: string
          id?: string
          league_id: string
          sample_size: number
          statistics?: Json
          team_id: string
          updated_at?: string
          venue?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["stat_category"]
          created_at?: string
          id?: string
          league_id?: string
          sample_size?: number
          statistics?: Json
          team_id?: string
          updated_at?: string
          venue?: string
        }
        Relationships: [
          {
            foreignKeyName: "statistics_cache_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "competition_coverage"
            referencedColumns: ["league_id"]
          },
          {
            foreignKeyName: "statistics_cache_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statistics_cache_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_jobs: {
        Row: {
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          job_name: string
          processed_records: number
          source: string
          started_at: string | null
          status: Database["public"]["Enums"]["sync_job_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          job_name: string
          processed_records?: number
          source: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["sync_job_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          job_name?: string
          processed_records?: number
          source?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["sync_job_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_jobs_source_fkey"
            columns: ["source"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      team_aliases: {
        Row: {
          alias: string
          created_at: string
          id: string
          normalized_alias: string
          source: string
          team_id: string
        }
        Insert: {
          alias: string
          created_at?: string
          id?: string
          normalized_alias: string
          source: string
          team_id: string
        }
        Update: {
          alias?: string
          created_at?: string
          id?: string
          normalized_alias?: string
          source?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_aliases_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          api_football_id: number | null
          country: string
          created_at: string
          fbref_id: string | null
          id: string
          league_id: string | null
          master_id: string | null
          name: string
          normalized_name: string
          updated_at: string
        }
        Insert: {
          api_football_id?: number | null
          country: string
          created_at?: string
          fbref_id?: string | null
          id?: string
          league_id?: string | null
          master_id?: string | null
          name: string
          normalized_name: string
          updated_at?: string
        }
        Update: {
          api_football_id?: number | null
          country?: string
          created_at?: string
          fbref_id?: string | null
          id?: string
          league_id?: string | null
          master_id?: string | null
          name?: string
          normalized_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "competition_coverage"
            referencedColumns: ["league_id"]
          },
          {
            foreignKeyName: "teams_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_master_id_fkey"
            columns: ["master_id"]
            isOneToOne: false
            referencedRelation: "teams_master"
            referencedColumns: ["id"]
          },
        ]
      }
      teams_master: {
        Row: {
          active: boolean
          aliases: string[]
          country: string
          created_at: string
          id: string
          normalized_name: string
          official_name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          aliases?: string[]
          country: string
          created_at?: string
          id?: string
          normalized_name: string
          official_name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          aliases?: string[]
          country?: string
          created_at?: string
          id?: string
          normalized_name?: string
          official_name?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      competition_coverage: {
        Row: {
          competition: string | null
          country: string | null
          future_fixtures: number | null
          last_sync: string | null
          league_id: string | null
          season: string | null
          source_used: string | null
          total_matches: number | null
        }
        Relationships: []
      }
      data_quality_summary: {
        Row: {
          duplicates_detected: number | null
          failed_imports: number | null
          matches_missing_stats: number | null
          unmatched_teams: number | null
        }
        Relationships: []
      }
      match_analytics: {
        Row: {
          away_clean_sheet: boolean | null
          away_team_id: string | null
          btts: boolean | null
          first_half_goals: number | null
          home_clean_sheet: boolean | null
          home_team_id: string | null
          league_id: string | null
          match_date: string | null
          match_id: string | null
          match_result: string | null
          over_0_5: boolean | null
          over_1_5: boolean | null
          over_2_5: boolean | null
          over_3_5: boolean | null
          over_4_5: boolean | null
          second_half_goals: number | null
          total_goals: number | null
        }
        Insert: {
          away_clean_sheet?: never
          away_team_id?: string | null
          btts?: never
          first_half_goals?: never
          home_clean_sheet?: never
          home_team_id?: string | null
          league_id?: string | null
          match_date?: string | null
          match_id?: string | null
          match_result?: never
          over_0_5?: never
          over_1_5?: never
          over_2_5?: never
          over_3_5?: never
          over_4_5?: never
          second_half_goals?: never
          total_goals?: never
        }
        Update: {
          away_clean_sheet?: never
          away_team_id?: string | null
          btts?: never
          first_half_goals?: never
          home_clean_sheet?: never
          home_team_id?: string | null
          league_id?: string | null
          match_date?: string | null
          match_id?: string | null
          match_result?: never
          over_0_5?: never
          over_1_5?: never
          over_2_5?: never
          over_3_5?: never
          over_4_5?: never
          second_half_goals?: never
          total_goals?: never
        }
        Relationships: [
          {
            foreignKeyName: "matches_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "competition_coverage"
            referencedColumns: ["league_id"]
          },
          {
            foreignKeyName: "matches_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      recent_team_matches: {
        Row: {
          is_home: boolean | null
          league_id: string | null
          match_date: string | null
          match_id: string | null
          opponent_cards: number | null
          opponent_corners: number | null
          opponent_goals: number | null
          opponent_id: string | null
          season: string | null
          team_cards: number | null
          team_corners: number | null
          team_goals: number | null
          team_id: string | null
          total_cards: number | null
          total_corners: number | null
          total_goals: number | null
        }
        Relationships: []
      }
      source_quality: {
        Row: {
          coverage_pct: number | null
          failed_runs: number | null
          last_successful_sync: string | null
          source: string | null
          successful_runs: number | null
        }
        Relationships: []
      }
      team_upcoming_matches: {
        Row: {
          away_league_country: string | null
          away_league_id: string | null
          away_league_name: string | null
          away_team_id: string | null
          away_team_name: string | null
          competition_country: string | null
          competition_id: string | null
          competition_name: string | null
          home_league_country: string | null
          home_league_id: string | null
          home_league_name: string | null
          home_team_id: string | null
          home_team_name: string | null
          id: string | null
          match_date: string | null
          round: string | null
          season: string | null
          status: Database["public"]["Enums"]["match_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_league_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competition_coverage"
            referencedColumns: ["league_id"]
          },
          {
            foreignKeyName: "matches_league_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_league_id_fkey"
            columns: ["home_league_id"]
            isOneToOne: false
            referencedRelation: "competition_coverage"
            referencedColumns: ["league_id"]
          },
          {
            foreignKeyName: "teams_league_id_fkey"
            columns: ["away_league_id"]
            isOneToOne: false
            referencedRelation: "competition_coverage"
            referencedColumns: ["league_id"]
          },
          {
            foreignKeyName: "teams_league_id_fkey"
            columns: ["home_league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_league_id_fkey"
            columns: ["away_league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      upcoming_matches: {
        Row: {
          away_team_id: string | null
          away_team_name: string | null
          home_team_id: string | null
          home_team_name: string | null
          id: string | null
          league_country: string | null
          league_id: string | null
          league_name: string | null
          match_date: string | null
          round: string | null
          season: string | null
          status: Database["public"]["Enums"]["match_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "competition_coverage"
            referencedColumns: ["league_id"]
          },
          {
            foreignKeyName: "matches_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      get_last_team_matches: {
        Args: { _sample_size?: number; _team_id: string }
        Returns: {
          is_home: boolean
          league_id: string
          match_date: string
          match_id: string
          opponent_cards: number
          opponent_corners: number
          opponent_goals: number
          opponent_id: string
          opponent_name: string
          season: string
          team_cards: number
          team_corners: number
          team_goals: number
          total_cards: number
          total_corners: number
          total_goals: number
        }[]
      }
      get_matchup_stats: {
        Args: {
          _away_team_id: string
          _category: Database["public"]["Enums"]["stat_category"]
          _home_team_id: string
          _league_id: string
          _market: string
          _sample_size?: number
        }
        Returns: {
          away_pct: number
          away_sample: Json
          away_team_id: string
          category: Database["public"]["Enums"]["stat_category"]
          combined_avg: number
          home_pct: number
          home_sample: Json
          home_team_id: string
          league_id: string
          market: string
          sample_size: number
        }[]
      }
      get_pipeline_diagnostics: {
        Args: never
        Returns: {
          country: string
          displayed_matches: number
          finished_matches: number
          fixtures_imported: number
          hidden_missing_stats: number
          hidden_missing_teams: number
          hidden_reason: string
          last_error: string
          last_sync: string
          league: string
          league_id: string
          season: string
          source_used: string
          sources: string
          statistics_coverage_pct: number
          total_matches: number
          upcoming_matches: number
        }[]
      }
      get_source_status: {
        Args: never
        Returns: {
          failed_runs: number
          last_error: string
          last_run: string
          last_status: string
          records_imported: number
          source: string
          total_runs: number
        }[]
      }
      get_team_market_stat: {
        Args: {
          _category: Database["public"]["Enums"]["stat_category"]
          _league_id: string
          _market: string
          _sample_size: number
          _team_id: string
        }
        Returns: number
      }
      get_top_defeats: {
        Args: {
          _hours?: number
          _league_ids?: string[]
          _limit?: number
          _sample_size?: number
        }
        Returns: {
          away_loss_pct: number
          away_team_id: string
          away_team_name: string
          competition_country: string
          competition_id: string
          competition_name: string
          home_loss_pct: number
          home_team_id: string
          home_team_name: string
          loss_pct: number
          match_date: string
          match_id: string
          predicted_loser: string
          predicted_loser_team_name: string
        }[]
      }
      get_top_picks: {
        Args: { _hours?: number; _limit?: number; _sample_size?: number }
        Returns: {
          away_pct: number
          away_team_id: string
          away_team_name: string
          category: Database["public"]["Enums"]["stat_category"]
          combined_avg: number
          home_pct: number
          home_team_id: string
          home_team_name: string
          league_country: string
          league_id: string
          league_name: string
          market: string
          match_date: string
          match_id: string
        }[]
      }
      get_top_picks_for_leagues: {
        Args: {
          _hours?: number
          _league_ids?: string[]
          _limit?: number
          _min_matches_used?: number
          _sample_size?: number
        }
        Returns: {
          away_matches_used: number
          away_pct: number
          away_team_id: string
          away_team_name: string
          category: Database["public"]["Enums"]["stat_category"]
          combined_avg: number
          competition_country: string
          competition_id: string
          competition_name: string
          home_matches_used: number
          home_pct: number
          home_team_id: string
          home_team_name: string
          market: string
          match_date: string
          match_id: string
        }[]
      }
      get_upcoming_diagnostics: {
        Args: never
        Returns: {
          country: string
          display_eligibility_reason: string
          latest_future_match: string
          league: string
          season: string
          statistics_coverage_pct: number
          upcoming_count: number
        }[]
      }
      get_upcoming_for_leagues: {
        Args: { _league_ids?: string[]; _limit?: number }
        Returns: {
          away_league_country: string | null
          away_league_id: string | null
          away_league_name: string | null
          away_team_id: string | null
          away_team_name: string | null
          competition_country: string | null
          competition_id: string | null
          competition_name: string | null
          home_league_country: string | null
          home_league_id: string | null
          home_league_name: string | null
          home_team_id: string | null
          home_team_name: string | null
          id: string | null
          match_date: string | null
          round: string | null
          season: string | null
          status: Database["public"]["Enums"]["match_status"] | null
        }[]
        SetofOptions: {
          from: "*"
          to: "team_upcoming_matches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_upcoming_matches_by_league: {
        Args: { _league_id: string; _limit?: number }
        Returns: {
          away_team_id: string | null
          away_team_name: string | null
          home_team_id: string | null
          home_team_name: string | null
          id: string | null
          league_country: string | null
          league_id: string | null
          league_name: string | null
          match_date: string | null
          round: string | null
          season: string | null
          status: Database["public"]["Enums"]["match_status"] | null
        }[]
        SetofOptions: {
          from: "*"
          to: "upcoming_matches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      is_national_team_competition: {
        Args: { _country: string }
        Returns: boolean
      }
      merge_leagues: {
        Args: { drop_id: string; keep_id: string }
        Returns: undefined
      }
      normalize_league_name: { Args: { input: string }; Returns: string }
      normalize_team_name: { Args: { input: string }; Returns: string }
      purge_old_matches: {
        Args: never
        Returns: {
          cutoff: string
          deleted: number
        }[]
      }
      resolve_league: {
        Args: {
          _country: string
          _name: string
          _season: string
          _source?: string
        }
        Returns: string
      }
      resolve_league_for_year: {
        Args: { _league_id: string; _match_year: number }
        Returns: string
      }
      resolve_match_provider_id: {
        Args: { _match_id: string; _provider: string }
        Returns: {
          match_id: string
          provider: string
          provider_match_id: string
        }[]
      }
      resolve_team_master: {
        Args: { _country: string; _name: string }
        Returns: string
      }
      season_year_set: { Args: { _season: string }; Returns: number[] }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      match_status:
        | "scheduled"
        | "live"
        | "finished"
        | "postponed"
        | "cancelled"
      stat_category: "goals" | "cards" | "corners" | "result" | "btts"
      sync_job_status:
        | "pending"
        | "running"
        | "success"
        | "failed"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      match_status: ["scheduled", "live", "finished", "postponed", "cancelled"],
      stat_category: ["goals", "cards", "corners", "result", "btts"],
      sync_job_status: ["pending", "running", "success", "failed", "cancelled"],
    },
  },
} as const
