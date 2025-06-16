--
-- PostgreSQL database dump
--

-- Dumped from database version 17.5
-- Dumped by pg_dump version 17.5 (Homebrew)

-- Started on 2025-06-15 23:28:14 EDT

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 6 (class 2615 OID 16476)
-- Name: neon_auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA neon_auth;


--
-- TOC entry 245 (class 1255 OID 32768)
-- Name: cleanup_old_pending_tokens(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_old_pending_tokens() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  DELETE FROM square_pending_tokens 
  WHERE created_at < NOW() - INTERVAL '1 day' OR obtained = true;
  RETURN NEW;
END;
$$;


--
-- TOC entry 246 (class 1255 OID 57360)
-- Name: cleanup_old_webhook_events(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_old_webhook_events() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    DELETE FROM webhook_events WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$;


--
-- TOC entry 244 (class 1255 OID 24589)
-- Name: delete_expired_pending_tokens(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_expired_pending_tokens() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  DELETE FROM square_pending_tokens WHERE created_at < NOW() - INTERVAL '1 hour';
  RETURN NULL;
END;
$$;


--
-- TOC entry 247 (class 1255 OID 106501)
-- Name: get_org_connections(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_org_connections(base_org_id text) RETURNS TABLE(id integer, organization_id text, device_id text, merchant_id text, location_id text, is_active boolean, created_at timestamp without time zone)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sc.id,
        sc.organization_id,
        sc.device_id,
        sc.merchant_id,
        sc.location_id,
        sc.is_active,
        sc.created_at
    FROM square_connections sc
    WHERE sc.organization_id LIKE base_org_id || '%'
    OR sc.organization_id = base_org_id;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 218 (class 1259 OID 16479)
-- Name: users_sync; Type: TABLE; Schema: neon_auth; Owner: -
--

CREATE TABLE neon_auth.users_sync (
    raw_json jsonb NOT NULL,
    id text GENERATED ALWAYS AS ((raw_json ->> 'id'::text)) STORED NOT NULL,
    name text GENERATED ALWAYS AS ((raw_json ->> 'display_name'::text)) STORED,
    email text GENERATED ALWAYS AS ((raw_json ->> 'primary_email'::text)) STORED,
    created_at timestamp with time zone GENERATED ALWAYS AS (to_timestamp((trunc((((raw_json ->> 'signed_up_at_millis'::text))::bigint)::double precision) / (1000)::double precision))) STORED,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone
);


--
-- TOC entry 243 (class 1259 OID 98324)
-- Name: device_coordination_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_coordination_events (
    id integer NOT NULL,
    organization_id character varying(255) NOT NULL,
    device_id character varying(255) NOT NULL,
    event_type character varying(50) NOT NULL,
    event_data jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 242 (class 1259 OID 98323)
-- Name: device_coordination_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.device_coordination_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3565 (class 0 OID 0)
-- Dependencies: 242
-- Name: device_coordination_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.device_coordination_events_id_seq OWNED BY public.device_coordination_events.id;


--
-- TOC entry 224 (class 1259 OID 16521)
-- Name: donations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.donations (
    id integer NOT NULL,
    organization_id integer,
    amount numeric(10,2) NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    donor_name text,
    donor_email text,
    payment_id text,
    payment_status text NOT NULL,
    receipt_sent boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    square_order_id text,
    is_custom_amount boolean DEFAULT false,
    catalog_item_id text,
    donation_type text DEFAULT 'one_time'::text
);


--
-- TOC entry 223 (class 1259 OID 16520)
-- Name: donations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.donations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3566 (class 0 OID 0)
-- Dependencies: 223
-- Name: donations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.donations_id_seq OWNED BY public.donations.id;


--
-- TOC entry 226 (class 1259 OID 16539)
-- Name: kiosk_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kiosk_settings (
    id integer NOT NULL,
    organization_id integer,
    timeout_seconds integer DEFAULT 60,
    welcome_message text,
    thank_you_message text,
    logo_url text,
    background_image_url text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    allow_custom_amount boolean DEFAULT true,
    min_custom_amount numeric(10,2) DEFAULT 1.00,
    max_custom_amount numeric(10,2) DEFAULT 1000.00,
    catalog_parent_id text,
    last_catalog_sync timestamp without time zone
);


--
-- TOC entry 225 (class 1259 OID 16538)
-- Name: kiosk_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.kiosk_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3567 (class 0 OID 0)
-- Dependencies: 225
-- Name: kiosk_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.kiosk_settings_id_seq OWNED BY public.kiosk_settings.id;


--
-- TOC entry 234 (class 1259 OID 49174)
-- Name: order_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_transactions (
    id integer NOT NULL,
    organization_id integer,
    donation_id integer,
    square_order_id text NOT NULL,
    square_payment_id text,
    order_status text DEFAULT 'PENDING'::text NOT NULL,
    payment_status text,
    amount numeric(10,2) NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    is_custom_amount boolean DEFAULT false,
    catalog_item_used text,
    order_data jsonb,
    payment_data jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 233 (class 1259 OID 49173)
-- Name: order_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.order_transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3568 (class 0 OID 0)
-- Dependencies: 233
-- Name: order_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.order_transactions_id_seq OWNED BY public.order_transactions.id;


--
-- TOC entry 222 (class 1259 OID 16507)
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id integer NOT NULL,
    name text NOT NULL,
    logo_url text,
    contact_email text,
    contact_phone text,
    square_merchant_id text,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    receipt_message text DEFAULT 'Thank you for your generous donation!'::text,
    website text,
    receipt_enabled boolean DEFAULT true,
    tax_id character varying(255)
);


--
-- TOC entry 221 (class 1259 OID 16506)
-- Name: organizations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.organizations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3569 (class 0 OID 0)
-- Dependencies: 221
-- Name: organizations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.organizations_id_seq OWNED BY public.organizations.id;


--
-- TOC entry 237 (class 1259 OID 57349)
-- Name: payment_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_events (
    id integer NOT NULL,
    payment_id character varying(255) NOT NULL,
    event_type character varying(100) NOT NULL,
    merchant_id character varying(255),
    order_id character varying(255),
    amount numeric(10,2),
    created_at timestamp without time zone NOT NULL
);


--
-- TOC entry 236 (class 1259 OID 57348)
-- Name: payment_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payment_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3570 (class 0 OID 0)
-- Dependencies: 236
-- Name: payment_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payment_events_id_seq OWNED BY public.payment_events.id;


--
-- TOC entry 232 (class 1259 OID 49153)
-- Name: preset_donations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.preset_donations (
    id integer NOT NULL,
    organization_id integer,
    amount numeric(10,2) NOT NULL,
    catalog_item_id text,
    catalog_variation_id text,
    is_active boolean DEFAULT true,
    display_order integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 231 (class 1259 OID 49152)
-- Name: preset_donations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.preset_donations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3571 (class 0 OID 0)
-- Dependencies: 231
-- Name: preset_donations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.preset_donations_id_seq OWNED BY public.preset_donations.id;


--
-- TOC entry 239 (class 1259 OID 90116)
-- Name: receipt_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.receipt_log (
    id integer NOT NULL,
    organization_id character varying(50) NOT NULL,
    donor_email character varying(255) NOT NULL,
    amount numeric(10,2) NOT NULL,
    transaction_id character varying(100),
    order_id character varying(100),
    delivery_status character varying(20) DEFAULT 'pending'::character varying,
    sendgrid_message_id character varying(100),
    delivery_error text,
    retry_count integer DEFAULT 0,
    requested_at timestamp without time zone DEFAULT now(),
    sent_at timestamp without time zone,
    last_retry_at timestamp without time zone,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 238 (class 1259 OID 90115)
-- Name: receipt_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.receipt_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3572 (class 0 OID 0)
-- Dependencies: 238
-- Name: receipt_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.receipt_log_id_seq OWNED BY public.receipt_log.id;


--
-- TOC entry 235 (class 1259 OID 49206)
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version text NOT NULL,
    applied_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 220 (class 1259 OID 16493)
-- Name: square_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.square_connections (
    id integer NOT NULL,
    organization_id text NOT NULL,
    merchant_id text NOT NULL,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    location_id text NOT NULL,
    is_active boolean DEFAULT true,
    revoked_at timestamp without time zone,
    last_catalog_sync timestamp without time zone,
    api_version character varying(20) DEFAULT '2025-05-21'::character varying,
    device_id text
);


--
-- TOC entry 219 (class 1259 OID 16492)
-- Name: square_connections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.square_connections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3573 (class 0 OID 0)
-- Dependencies: 219
-- Name: square_connections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.square_connections_id_seq OWNED BY public.square_connections.id;


--
-- TOC entry 241 (class 1259 OID 98305)
-- Name: square_device_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.square_device_connections (
    id integer NOT NULL,
    device_id character varying(255) NOT NULL,
    organization_id character varying(255) NOT NULL,
    merchant_id character varying(255) NOT NULL,
    location_id character varying(255) NOT NULL,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    is_primary_device boolean DEFAULT false,
    last_heartbeat timestamp without time zone DEFAULT now(),
    device_name character varying(255),
    device_model character varying(255),
    app_version character varying(50),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- TOC entry 240 (class 1259 OID 98304)
-- Name: square_device_connections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.square_device_connections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3574 (class 0 OID 0)
-- Dependencies: 240
-- Name: square_device_connections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.square_device_connections_id_seq OWNED BY public.square_device_connections.id;


--
-- TOC entry 230 (class 1259 OID 24577)
-- Name: square_pending_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.square_pending_tokens (
    id integer NOT NULL,
    state character varying(255) NOT NULL,
    access_token text,
    refresh_token text,
    merchant_id character varying(255),
    expires_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    obtained boolean DEFAULT false,
    location_id text,
    location_data text,
    device_id text
);


--
-- TOC entry 229 (class 1259 OID 24576)
-- Name: square_pending_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.square_pending_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3575 (class 0 OID 0)
-- Dependencies: 229
-- Name: square_pending_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.square_pending_tokens_id_seq OWNED BY public.square_pending_tokens.id;


--
-- TOC entry 228 (class 1259 OID 16558)
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_events (
    id integer NOT NULL,
    event_id text NOT NULL,
    event_type text NOT NULL,
    merchant_id text NOT NULL,
    data jsonb NOT NULL,
    processed boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 227 (class 1259 OID 16557)
-- Name: webhook_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.webhook_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3576 (class 0 OID 0)
-- Dependencies: 227
-- Name: webhook_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.webhook_events_id_seq OWNED BY public.webhook_events.id;


--
-- TOC entry 3312 (class 2604 OID 98327)
-- Name: device_coordination_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_coordination_events ALTER COLUMN id SET DEFAULT nextval('public.device_coordination_events_id_seq'::regclass);


--
-- TOC entry 3270 (class 2604 OID 16524)
-- Name: donations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donations ALTER COLUMN id SET DEFAULT nextval('public.donations_id_seq'::regclass);


--
-- TOC entry 3277 (class 2604 OID 16542)
-- Name: kiosk_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kiosk_settings ALTER COLUMN id SET DEFAULT nextval('public.kiosk_settings_id_seq'::regclass);


--
-- TOC entry 3294 (class 2604 OID 49177)
-- Name: order_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_transactions ALTER COLUMN id SET DEFAULT nextval('public.order_transactions_id_seq'::regclass);


--
-- TOC entry 3264 (class 2604 OID 16510)
-- Name: organizations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations ALTER COLUMN id SET DEFAULT nextval('public.organizations_id_seq'::regclass);


--
-- TOC entry 3301 (class 2604 OID 57352)
-- Name: payment_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events ALTER COLUMN id SET DEFAULT nextval('public.payment_events_id_seq'::regclass);


--
-- TOC entry 3290 (class 2604 OID 49156)
-- Name: preset_donations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preset_donations ALTER COLUMN id SET DEFAULT nextval('public.preset_donations_id_seq'::regclass);


--
-- TOC entry 3302 (class 2604 OID 90119)
-- Name: receipt_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_log ALTER COLUMN id SET DEFAULT nextval('public.receipt_log_id_seq'::regclass);


--
-- TOC entry 3259 (class 2604 OID 16496)
-- Name: square_connections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.square_connections ALTER COLUMN id SET DEFAULT nextval('public.square_connections_id_seq'::regclass);


--
-- TOC entry 3307 (class 2604 OID 98308)
-- Name: square_device_connections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.square_device_connections ALTER COLUMN id SET DEFAULT nextval('public.square_device_connections_id_seq'::regclass);


--
-- TOC entry 3287 (class 2604 OID 24580)
-- Name: square_pending_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.square_pending_tokens ALTER COLUMN id SET DEFAULT nextval('public.square_pending_tokens_id_seq'::regclass);


--
-- TOC entry 3284 (class 2604 OID 16561)
-- Name: webhook_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events ALTER COLUMN id SET DEFAULT nextval('public.webhook_events_id_seq'::regclass);


--
-- TOC entry 3534 (class 0 OID 16479)
-- Dependencies: 218
-- Data for Name: users_sync; Type: TABLE DATA; Schema: neon_auth; Owner: -
--

COPY neon_auth.users_sync (raw_json, updated_at, deleted_at) FROM stdin;
\.


--
-- TOC entry 3559 (class 0 OID 98324)
-- Dependencies: 243
-- Data for Name: device_coordination_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.device_coordination_events (id, organization_id, device_id, event_type, event_data, created_at) FROM stdin;
\.


--
-- TOC entry 3540 (class 0 OID 16521)
-- Dependencies: 224
-- Data for Name: donations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.donations (id, organization_id, amount, currency, donor_name, donor_email, payment_id, payment_status, receipt_sent, created_at, updated_at, square_order_id, is_custom_amount, catalog_item_id, donation_type) FROM stdin;
\.


--
-- TOC entry 3542 (class 0 OID 16539)
-- Dependencies: 226
-- Data for Name: kiosk_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.kiosk_settings (id, organization_id, timeout_seconds, welcome_message, thank_you_message, logo_url, background_image_url, created_at, updated_at, allow_custom_amount, min_custom_amount, max_custom_amount, catalog_parent_id, last_catalog_sync) FROM stdin;
\.


--
-- TOC entry 3550 (class 0 OID 49174)
-- Dependencies: 234
-- Data for Name: order_transactions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.order_transactions (id, organization_id, donation_id, square_order_id, square_payment_id, order_status, payment_status, amount, currency, is_custom_amount, catalog_item_used, order_data, payment_data, created_at, updated_at) FROM stdin;
\.


--
-- TOC entry 3538 (class 0 OID 16507)
-- Dependencies: 222
-- Data for Name: organizations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.organizations (id, name, logo_url, contact_email, contact_phone, square_merchant_id, active, created_at, updated_at, receipt_message, website, receipt_enabled, tax_id) FROM stdin;
1	Your Organization	\N	\N	\N	\N	t	2025-06-05 20:10:03.651469	2025-06-05 20:10:03.651469	Thank you for your generous donation!	\N	t	12-3456789
\.


--
-- TOC entry 3553 (class 0 OID 57349)
-- Dependencies: 237
-- Data for Name: payment_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.payment_events (id, payment_id, event_type, merchant_id, order_id, amount, created_at) FROM stdin;
\.


--
-- TOC entry 3548 (class 0 OID 49153)
-- Dependencies: 232
-- Data for Name: preset_donations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.preset_donations (id, organization_id, amount, catalog_item_id, catalog_variation_id, is_active, display_order, created_at, updated_at) FROM stdin;
\.


--
-- TOC entry 3555 (class 0 OID 90116)
-- Dependencies: 239
-- Data for Name: receipt_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.receipt_log (id, organization_id, donor_email, amount, transaction_id, order_id, delivery_status, sendgrid_message_id, delivery_error, retry_count, requested_at, sent_at, last_retry_at, updated_at) FROM stdin;
1	default	zalmanrodkin@gmail.com	1.00	hEArWVgFHEWF0NME6btHiYgkx5eZY	TQxF5IoQMAF8X3xcwXL0JsOsl3LZY	failed	\N	SendGrid API error: The from address does not match a verified Sender Identity. Mail cannot be sent until this error is resolved. Visit https://sendgrid.com/docs/for-developers/sending-email/sender-identity/ to see the Sender Identity requirements	1	2025-06-01 23:41:17.075546	\N	2025-06-01 23:41:18.117233	2025-06-01 23:41:18.117233
2	default	zalmanrodkin@gmail.com	1.00	fjmIH9f1n2GXdm67RSgdjUazU1GZY	Nh3BqH0z3ZRyCYT3HjLSynOhGAWZY	sent	RNcjalnrSTmgydIsjGgY3g	\N	0	2025-06-01 23:53:35.501029	2025-06-01 23:53:35.656226	\N	2025-06-01 23:53:35.656226
3	default	zalmanrodkin@gmail.com	1.00	j37SbGDvbFr3HBbkxeXIBIiRlyFZY	xfTYUnCCj4kfsJn21q48oJI0ncaZY	sent	Gxu6ckiPQc2Yy_btWU2qAQ	\N	0	2025-06-04 19:54:47.272034	2025-06-04 19:54:47.674819	\N	2025-06-04 19:54:47.674819
4	default	zalmanrodkin@gmail.com	25.00	test_payment_456	test_order_123	sent	AXe0JaNuQAW-p1IcZ54GhQ	\N	0	2025-06-04 20:06:01.174355	2025-06-04 20:06:01.397319	\N	2025-06-04 20:06:01.397319
5	default	zalmanrodkin@gmail.com	25.00	test_payment_456	test_order_123	sent	kp2fP3S4RIOB5o7JTIM3Xw	\N	0	2025-06-04 22:49:51.708436	2025-06-04 22:49:52.030015	\N	2025-06-04 22:49:52.030015
6	default	zalmanrodkin@gmail.com	25.00	test_payment_456	test_order_123	sent	4jFRb2EmSA6OhktZAhhM1w	\N	0	2025-06-05 02:44:34.861772	2025-06-05 02:44:35.320042	\N	2025-06-05 02:44:35.320042
7	default	zalmanrodkin@gmail.com	25.00	test_payment_456	test_order_123	sent	_6tGggBjQ4qAUaXoSduKAA	\N	0	2025-06-05 20:17:06.709274	2025-06-05 20:17:06.977737	\N	2025-06-05 20:17:06.977737
8	default	zalmanrodkin@gmail.com	25.00	test_payment_456	test_order_123	sent	uWQIxoMbTjyp61f32Bg-_A	\N	0	2025-06-05 22:43:13.026629	2025-06-05 22:43:13.36779	\N	2025-06-05 22:43:13.36779
9	default	zalmanrodkin@gmail.com	25.00	test_payment_456	test_order_123	sent	5Dd8QMpcSJGm6ahGSvYaaw	\N	0	2025-06-05 22:52:15.428435	2025-06-05 22:52:15.885354	\N	2025-06-05 22:52:15.885354
10	default	zalmanrodkin@gmail.com	25.00	test_payment_456	test_order_123	sent	7i6DTXjzRV6JdvbVaKX4sQ	\N	0	2025-06-05 23:06:44.25931	2025-06-05 23:06:44.575209	\N	2025-06-05 23:06:44.575209
11	default	zalmanrodkin@gmail.com	25.00	test_payment_456	test_order_123	sent	YUS26ztyQy-3iVw3baAcnQ	\N	0	2025-06-05 23:14:21.890221	2025-06-05 23:14:22.211171	\N	2025-06-05 23:14:22.211171
12	default	zalmanrodkin@gmail.com	1.00	DdA3roUA99SPHIMFmpLHeCV4PIcZY	ZtQ0cOqKsevyLTBGfyRiaCcHP9aZY	sent	6lytJsyuSN2pHnVSx5OTIQ	\N	0	2025-06-06 06:53:20.649025	2025-06-06 06:53:20.838304	\N	2025-06-06 06:53:20.838304
13	default	zalmanrodkin@gmail.com	1.00	bHBUzVVs0Qvobws5WhMM6YgX9sTZY	Zbd5JIPvC3XPaRTQywE6HuKrOTTZY	sent	Losg17brTj6IQiViWBaDRg	\N	0	2025-06-06 07:34:38.399554	2025-06-06 07:34:38.676029	\N	2025-06-06 07:34:38.676029
14	default	zalmanrodkin@gmail.com	1.00	ZgSkWvMj4pW8466gw7tVFrBJMRRZY	H6jKDxtXSRYMsyUAJ9yTcgtWbzIZY	sent	2tlN0D6xQgCaObfpbbActQ	\N	0	2025-06-06 07:44:22.070031	2025-06-06 07:44:22.54498	\N	2025-06-06 07:44:22.54498
15	default	zalmanrodkin@gmail.com	1.00	ThccUXI4o8cd9MzXGyKHpXqNi2ZZY	BRcYlMegbUfiV6uxD33rb0HWmJZZY	sent	iCnNj5TiT8ugg2Mfm5RzMA	\N	0	2025-06-06 07:57:26.88278	2025-06-06 07:57:27.260838	\N	2025-06-06 07:57:27.260838
16	default	zalmanrodkin@gmail.com	1.00	vD4PLGrI7IuzuCAvqtceRVyrxuEZY	PEg7x1Kzl8ogRWwdcgEFuQXvTO7YY	sent	VnhY8-dhRByRoDHBqANFIw	\N	0	2025-06-06 08:02:06.708657	2025-06-06 08:02:07.207585	\N	2025-06-06 08:02:07.207585
17	default	zalmanrodkin@gmail.com	1.00	ZiHoNQckgcTSIE4qqAvYGDhjGEgZY	tZfVJ82PC0sdPJPh8k7DIpbQvpIZY	sent	RmwnMgvhQb-5lVR5YuOglQ	\N	0	2025-06-06 08:05:32.611672	2025-06-06 08:05:32.894247	\N	2025-06-06 08:05:32.894247
18	default	zalmanrodkin@gmail.com	1.00	BeTYVLH7q17t5MD3R46UcdDeWwZZY	HIgrWpVTFEhOd6RIVTiq394QxzLZY	sent	4sqEFW2BRh6mUQBOczRrbA	\N	0	2025-06-06 08:09:27.84662	2025-06-06 08:09:28.041608	\N	2025-06-06 08:09:28.041608
19	default	mendypeer@gmail.com	1.00	9sF1N7LTS20nGicTDf5xV9IEw8QZY	aettRfTrvYi7HdZoEoWAIUxKYnVZY	sent	sx38zRoxR4SiH9VvZtwoUw	\N	0	2025-06-06 14:23:32.69494	2025-06-06 14:23:32.941531	\N	2025-06-06 14:23:32.941531
20	default	yossitombosky@icloud.com	1.00	Bs2uzmcFjEraVkHl57jNaKJOVoAZY	gBbGqb9axzQywkDYggExWJ8FRt8YY	sent	_4zvlrbvRoiz1xDzf1baOw	\N	0	2025-06-06 16:56:55.360877	2025-06-06 16:56:55.722867	\N	2025-06-06 16:56:55.722867
21	default	mejsche@gmail.com	25.00	ftn46u3rpNSFdPBXzUUjkSl35gPZY	Mhk6HN4JX28kfDjhsf3yICWqNsMZY	sent	Bgg4l-vSQzWMO1XNzP7-UA	\N	0	2025-06-06 19:12:20.649637	2025-06-06 19:12:21.044455	\N	2025-06-06 19:12:21.044455
22	default	zalmanrodkin@gmail.com	1.00	7JeO3fqRWbJyrcamq16H3kfNymKZY	vGXweiUCmTxvprkg3ZPLxBArZnIZY	sent	pVOtbMtMSGqmd-m8VJvA_w	\N	0	2025-06-08 01:59:54.017746	2025-06-08 01:59:54.407741	\N	2025-06-08 01:59:54.407741
23	default	zalmanrodkin@gmail.com	1.00	1QFvJm8hHWYD8p6syzfAdlz8ZaAZY	vi7xvZU1zJYLTThvK6iS3HIcnx5YY	sent	Mb9IUDnYTE6mJXEuIQm38w	\N	0	2025-06-08 02:04:21.724124	2025-06-08 02:04:22.171529	\N	2025-06-08 02:04:22.171529
24	default	info@larkla.com	18.00	hipAedBNK3KxqIIBRJVAEwtpIbAZY	KGj0V3p8UK1Vp7m32ykE8ShnW4MZY	sent	RsuAWSjIQyq4la9XxkTU-g	\N	0	2025-06-08 21:24:33.724939	2025-06-08 21:24:34.034303	\N	2025-06-08 21:24:34.034303
25	default	mendyfaygen@gmail.com	100.00	nT2jSfXPjh0dUajshG8BCF4JyOCZY	mgTTE8JhCNYSltamJ2gsXiUbjvJZY	sent	YoC7QgK5Sj2rgnrE_kKSzQ	\N	0	2025-06-09 01:48:35.631031	2025-06-09 01:48:35.919504	\N	2025-06-09 01:48:35.919504
26	default	zalmanrodkin@gmail.com	1.00	n7QYN4dWAWqRilIbKMXEL7mFhIAZY	cBaLTip37LCMbq5m4B5ZN5ffJ2SZY	sent	GxN9d7jDQ7yDYfy-87zr0g	\N	0	2025-06-09 01:54:52.134602	2025-06-09 01:54:52.603091	\N	2025-06-09 01:54:52.603091
\.


--
-- TOC entry 3551 (class 0 OID 49206)
-- Dependencies: 235
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.schema_migrations (version, applied_at) FROM stdin;
20240521_catalog_integration	2025-05-21 14:57:53.923855
20250526_backend_essentials_only	2025-05-26 06:15:31.833871
\.


--
-- TOC entry 3536 (class 0 OID 16493)
-- Dependencies: 220
-- Data for Name: square_connections; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.square_connections (id, organization_id, merchant_id, access_token, refresh_token, expires_at, created_at, updated_at, location_id, is_active, revoked_at, last_catalog_sync, api_version, device_id) FROM stdin;
193	default	MLE0CT8RWF16F	EAAAlodCGG8PT9X176lR3z8xA0IltUZxXprYYQpkLoNhVJRFNMzSciwsL2Kc-699	EQAAltggAthaLMt0JE3oNKUCSnWhQAJefQT1QvKMhOrPM6QFDpo02QyhWI16H0ud	2025-07-16 02:34:42	2025-06-11 23:56:37.38006	2025-06-16 02:34:46.70194	L96TE51REN2VG	t	\N	\N	2025-05-21	\N
\.


--
-- TOC entry 3557 (class 0 OID 98305)
-- Dependencies: 241
-- Data for Name: square_device_connections; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.square_device_connections (id, device_id, organization_id, merchant_id, location_id, access_token, refresh_token, expires_at, is_primary_device, last_heartbeat, device_name, device_model, app_version, created_at, updated_at) FROM stdin;
\.


--
-- TOC entry 3546 (class 0 OID 24577)
-- Dependencies: 230
-- Data for Name: square_pending_tokens; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.square_pending_tokens (id, state, access_token, refresh_token, merchant_id, expires_at, created_at, obtained, location_id, location_data, device_id) FROM stdin;
352	e87ce2e9-9e92-48c2-987b-62388aa37294	\N	\N	\N	\N	2025-06-16 02:23:21.196537	f	\N	\N	1E1FC5E6-7D73-4449-B9C0-46A48178BCC7
349	051623dc-ffb7-4c3c-beca-53e4e50e57e7	\N	\N	\N	\N	2025-06-16 02:13:12.185065	f	\N	\N	1E1FC5E6-7D73-4449-B9C0-46A48178BCC7
350	9b1ac093-fabc-484a-b652-69bcd8d32708	\N	\N	\N	\N	2025-06-16 02:13:36.281694	f	\N	\N	1E1FC5E6-7D73-4449-B9C0-46A48178BCC7
351	5acd666d-ffd6-4f4e-a90b-82b6b6ccc9bd	\N	\N	\N	\N	2025-06-16 02:22:30.238141	f	\N	\N	1E1FC5E6-7D73-4449-B9C0-46A48178BCC7
353	7bd506bf-dc41-455e-a33b-c9e33fd4532e	\N	\N	\N	\N	2025-06-16 02:30:29.616497	f	\N	\N	1E1FC5E6-7D73-4449-B9C0-46A48178BCC7
354	c136b498-0fc4-42e1-b4b9-a0bbabe5f17a	EAAAlodCGG8PT9X176lR3z8xA0IltUZxXprYYQpkLoNhVJRFNMzSciwsL2Kc-699	EQAAltggAthaLMt0JE3oNKUCSnWhQAJefQT1QvKMhOrPM6QFDpo02QyhWI16H0ud	MLE0CT8RWF16F	2025-07-16 02:34:42	2025-06-16 02:34:25.884043	f	L96TE51REN2VG	\N	1E1FC5E6-7D73-4449-B9C0-46A48178BCC7
\.


--
-- TOC entry 3544 (class 0 OID 16558)
-- Dependencies: 228
-- Data for Name: webhook_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.webhook_events (id, event_id, event_type, merchant_id, data, processed, created_at) FROM stdin;
\.


--
-- TOC entry 3577 (class 0 OID 0)
-- Dependencies: 242
-- Name: device_coordination_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.device_coordination_events_id_seq', 1, false);


--
-- TOC entry 3578 (class 0 OID 0)
-- Dependencies: 223
-- Name: donations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.donations_id_seq', 1, false);


--
-- TOC entry 3579 (class 0 OID 0)
-- Dependencies: 225
-- Name: kiosk_settings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.kiosk_settings_id_seq', 1, false);


--
-- TOC entry 3580 (class 0 OID 0)
-- Dependencies: 233
-- Name: order_transactions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.order_transactions_id_seq', 1, false);


--
-- TOC entry 3581 (class 0 OID 0)
-- Dependencies: 221
-- Name: organizations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.organizations_id_seq', 1, false);


--
-- TOC entry 3582 (class 0 OID 0)
-- Dependencies: 236
-- Name: payment_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.payment_events_id_seq', 1, false);


--
-- TOC entry 3583 (class 0 OID 0)
-- Dependencies: 231
-- Name: preset_donations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.preset_donations_id_seq', 1, false);


--
-- TOC entry 3584 (class 0 OID 0)
-- Dependencies: 238
-- Name: receipt_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.receipt_log_id_seq', 26, true);


--
-- TOC entry 3585 (class 0 OID 0)
-- Dependencies: 219
-- Name: square_connections_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.square_connections_id_seq', 229, true);


--
-- TOC entry 3586 (class 0 OID 0)
-- Dependencies: 240
-- Name: square_device_connections_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.square_device_connections_id_seq', 1, false);


--
-- TOC entry 3587 (class 0 OID 0)
-- Dependencies: 229
-- Name: square_pending_tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.square_pending_tokens_id_seq', 354, true);


--
-- TOC entry 3588 (class 0 OID 0)
-- Dependencies: 227
-- Name: webhook_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.webhook_events_id_seq', 1, false);


--
-- TOC entry 3316 (class 2606 OID 16489)
-- Name: users_sync users_sync_pkey; Type: CONSTRAINT; Schema: neon_auth; Owner: -
--

ALTER TABLE ONLY neon_auth.users_sync
    ADD CONSTRAINT users_sync_pkey PRIMARY KEY (id);


--
-- TOC entry 3380 (class 2606 OID 98332)
-- Name: device_coordination_events device_coordination_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_coordination_events
    ADD CONSTRAINT device_coordination_events_pkey PRIMARY KEY (id);


--
-- TOC entry 3329 (class 2606 OID 16532)
-- Name: donations donations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_pkey PRIMARY KEY (id);


--
-- TOC entry 3331 (class 2606 OID 16551)
-- Name: kiosk_settings kiosk_settings_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kiosk_settings
    ADD CONSTRAINT kiosk_settings_organization_id_key UNIQUE (organization_id);


--
-- TOC entry 3333 (class 2606 OID 16549)
-- Name: kiosk_settings kiosk_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kiosk_settings
    ADD CONSTRAINT kiosk_settings_pkey PRIMARY KEY (id);


--
-- TOC entry 3356 (class 2606 OID 49186)
-- Name: order_transactions order_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_transactions
    ADD CONSTRAINT order_transactions_pkey PRIMARY KEY (id);


--
-- TOC entry 3358 (class 2606 OID 49188)
-- Name: order_transactions order_transactions_square_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_transactions
    ADD CONSTRAINT order_transactions_square_order_id_key UNIQUE (square_order_id);


--
-- TOC entry 3325 (class 2606 OID 16517)
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- TOC entry 3327 (class 2606 OID 16519)
-- Name: organizations organizations_square_merchant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_square_merchant_id_key UNIQUE (square_merchant_id);


--
-- TOC entry 3363 (class 2606 OID 57358)
-- Name: payment_events payment_events_payment_id_event_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_payment_id_event_type_key UNIQUE (payment_id, event_type);


--
-- TOC entry 3365 (class 2606 OID 57356)
-- Name: payment_events payment_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_pkey PRIMARY KEY (id);


--
-- TOC entry 3350 (class 2606 OID 49165)
-- Name: preset_donations preset_donations_organization_id_amount_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preset_donations
    ADD CONSTRAINT preset_donations_organization_id_amount_key UNIQUE (organization_id, amount);


--
-- TOC entry 3352 (class 2606 OID 49163)
-- Name: preset_donations preset_donations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preset_donations
    ADD CONSTRAINT preset_donations_pkey PRIMARY KEY (id);


--
-- TOC entry 3370 (class 2606 OID 90127)
-- Name: receipt_log receipt_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_log
    ADD CONSTRAINT receipt_log_pkey PRIMARY KEY (id);


--
-- TOC entry 3360 (class 2606 OID 49213)
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- TOC entry 3319 (class 2606 OID 16502)
-- Name: square_connections square_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.square_connections
    ADD CONSTRAINT square_connections_pkey PRIMARY KEY (id);


--
-- TOC entry 3376 (class 2606 OID 98318)
-- Name: square_device_connections square_device_connections_device_id_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.square_device_connections
    ADD CONSTRAINT square_device_connections_device_id_organization_id_key UNIQUE (device_id, organization_id);


--
-- TOC entry 3378 (class 2606 OID 98316)
-- Name: square_device_connections square_device_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.square_device_connections
    ADD CONSTRAINT square_device_connections_pkey PRIMARY KEY (id);


--
-- TOC entry 3344 (class 2606 OID 24585)
-- Name: square_pending_tokens square_pending_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.square_pending_tokens
    ADD CONSTRAINT square_pending_tokens_pkey PRIMARY KEY (id);


--
-- TOC entry 3321 (class 2606 OID 106497)
-- Name: square_connections unique_org_device; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.square_connections
    ADD CONSTRAINT unique_org_device UNIQUE (organization_id, device_id);


--
-- TOC entry 3323 (class 2606 OID 114689)
-- Name: square_connections unique_organization_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.square_connections
    ADD CONSTRAINT unique_organization_id UNIQUE (organization_id);


--
-- TOC entry 3346 (class 2606 OID 106500)
-- Name: square_pending_tokens unique_state_device; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.square_pending_tokens
    ADD CONSTRAINT unique_state_device UNIQUE (state, device_id);


--
-- TOC entry 3338 (class 2606 OID 16569)
-- Name: webhook_events webhook_events_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_event_id_key UNIQUE (event_id);


--
-- TOC entry 3340 (class 2606 OID 16567)
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);


--
-- TOC entry 3314 (class 1259 OID 16490)
-- Name: users_sync_deleted_at_idx; Type: INDEX; Schema: neon_auth; Owner: -
--

CREATE INDEX users_sync_deleted_at_idx ON neon_auth.users_sync USING btree (deleted_at);


--
-- TOC entry 3381 (class 1259 OID 98333)
-- Name: idx_device_coordination_events_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_coordination_events_org ON public.device_coordination_events USING btree (organization_id, created_at);


--
-- TOC entry 3353 (class 1259 OID 49200)
-- Name: idx_order_transactions_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_transactions_organization_id ON public.order_transactions USING btree (organization_id);


--
-- TOC entry 3354 (class 1259 OID 49199)
-- Name: idx_order_transactions_square_ids; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_transactions_square_ids ON public.order_transactions USING btree (square_order_id, square_payment_id);


--
-- TOC entry 3361 (class 1259 OID 57359)
-- Name: idx_payment_events_payment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_events_payment_id ON public.payment_events USING btree (payment_id);


--
-- TOC entry 3347 (class 1259 OID 49172)
-- Name: idx_preset_donations_catalog_ids; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_preset_donations_catalog_ids ON public.preset_donations USING btree (catalog_variation_id);


--
-- TOC entry 3348 (class 1259 OID 49171)
-- Name: idx_preset_donations_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_preset_donations_organization_id ON public.preset_donations USING btree (organization_id);


--
-- TOC entry 3366 (class 1259 OID 90128)
-- Name: idx_receipt_log_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receipt_log_org_id ON public.receipt_log USING btree (organization_id);


--
-- TOC entry 3367 (class 1259 OID 90130)
-- Name: idx_receipt_log_requested_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receipt_log_requested_at ON public.receipt_log USING btree (requested_at);


--
-- TOC entry 3368 (class 1259 OID 90129)
-- Name: idx_receipt_log_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receipt_log_status ON public.receipt_log USING btree (delivery_status);


--
-- TOC entry 3317 (class 1259 OID 106498)
-- Name: idx_square_connections_org_device; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_square_connections_org_device ON public.square_connections USING btree (organization_id, device_id);


--
-- TOC entry 3371 (class 1259 OID 98322)
-- Name: idx_square_device_connections_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_square_device_connections_active ON public.square_device_connections USING btree (organization_id, is_primary_device, last_heartbeat);


--
-- TOC entry 3372 (class 1259 OID 98320)
-- Name: idx_square_device_connections_device_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_square_device_connections_device_id ON public.square_device_connections USING btree (device_id);


--
-- TOC entry 3373 (class 1259 OID 98321)
-- Name: idx_square_device_connections_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_square_device_connections_organization_id ON public.square_device_connections USING btree (organization_id);


--
-- TOC entry 3341 (class 1259 OID 65536)
-- Name: idx_square_pending_tokens_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_square_pending_tokens_merchant ON public.square_pending_tokens USING btree (merchant_id) WHERE (merchant_id IS NOT NULL);


--
-- TOC entry 3342 (class 1259 OID 24588)
-- Name: idx_square_pending_tokens_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_square_pending_tokens_state ON public.square_pending_tokens USING btree (state);


--
-- TOC entry 3374 (class 1259 OID 98319)
-- Name: idx_unique_primary_device_per_org; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_unique_primary_device_per_org ON public.square_device_connections USING btree (organization_id) WHERE (is_primary_device = true);


--
-- TOC entry 3334 (class 1259 OID 57346)
-- Name: idx_webhook_events_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_event_type ON public.webhook_events USING btree (event_type);


--
-- TOC entry 3335 (class 1259 OID 98334)
-- Name: idx_webhook_events_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_merchant ON public.webhook_events USING btree (merchant_id, created_at);


--
-- TOC entry 3336 (class 1259 OID 57347)
-- Name: idx_webhook_events_merchant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_merchant_id ON public.webhook_events USING btree (merchant_id);


--
-- TOC entry 3387 (class 2620 OID 40963)
-- Name: square_pending_tokens trigger_cleanup_old_pending_tokens; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_cleanup_old_pending_tokens AFTER INSERT ON public.square_pending_tokens FOR EACH STATEMENT EXECUTE FUNCTION public.cleanup_old_pending_tokens();


--
-- TOC entry 3388 (class 2620 OID 24590)
-- Name: square_pending_tokens trigger_delete_expired_pending_tokens; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_delete_expired_pending_tokens AFTER INSERT ON public.square_pending_tokens FOR EACH STATEMENT EXECUTE FUNCTION public.delete_expired_pending_tokens();


--
-- TOC entry 3382 (class 2606 OID 16533)
-- Name: donations donations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- TOC entry 3383 (class 2606 OID 16552)
-- Name: kiosk_settings kiosk_settings_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kiosk_settings
    ADD CONSTRAINT kiosk_settings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- TOC entry 3385 (class 2606 OID 49194)
-- Name: order_transactions order_transactions_donation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_transactions
    ADD CONSTRAINT order_transactions_donation_id_fkey FOREIGN KEY (donation_id) REFERENCES public.donations(id);


--
-- TOC entry 3386 (class 2606 OID 49189)
-- Name: order_transactions order_transactions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_transactions
    ADD CONSTRAINT order_transactions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- TOC entry 3384 (class 2606 OID 49166)
-- Name: preset_donations preset_donations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preset_donations
    ADD CONSTRAINT preset_donations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


-- Completed on 2025-06-15 23:28:18 EDT

--
-- PostgreSQL database dump complete
--

