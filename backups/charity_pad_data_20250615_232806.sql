--
-- PostgreSQL database dump
--

-- Dumped from database version 17.5
-- Dumped by pg_dump version 17.5 (Homebrew)

-- Started on 2025-06-15 23:28:10 EDT

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
-- TOC entry 3475 (class 0 OID 16479)
-- Dependencies: 218
-- Data for Name: users_sync; Type: TABLE DATA; Schema: neon_auth; Owner: -
--

SET SESSION AUTHORIZATION DEFAULT;

ALTER TABLE neon_auth.users_sync DISABLE TRIGGER ALL;

COPY neon_auth.users_sync (raw_json, updated_at, deleted_at) FROM stdin;
\.


ALTER TABLE neon_auth.users_sync ENABLE TRIGGER ALL;

--
-- TOC entry 3500 (class 0 OID 98324)
-- Dependencies: 243
-- Data for Name: device_coordination_events; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.device_coordination_events DISABLE TRIGGER ALL;

COPY public.device_coordination_events (id, organization_id, device_id, event_type, event_data, created_at) FROM stdin;
\.


ALTER TABLE public.device_coordination_events ENABLE TRIGGER ALL;

--
-- TOC entry 3479 (class 0 OID 16507)
-- Dependencies: 222
-- Data for Name: organizations; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.organizations DISABLE TRIGGER ALL;

COPY public.organizations (id, name, logo_url, contact_email, contact_phone, square_merchant_id, active, created_at, updated_at, receipt_message, website, receipt_enabled, tax_id) FROM stdin;
1	Your Organization	\N	\N	\N	\N	t	2025-06-05 20:10:03.651469	2025-06-05 20:10:03.651469	Thank you for your generous donation!	\N	t	12-3456789
\.


ALTER TABLE public.organizations ENABLE TRIGGER ALL;

--
-- TOC entry 3481 (class 0 OID 16521)
-- Dependencies: 224
-- Data for Name: donations; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.donations DISABLE TRIGGER ALL;

COPY public.donations (id, organization_id, amount, currency, donor_name, donor_email, payment_id, payment_status, receipt_sent, created_at, updated_at, square_order_id, is_custom_amount, catalog_item_id, donation_type) FROM stdin;
\.


ALTER TABLE public.donations ENABLE TRIGGER ALL;

--
-- TOC entry 3483 (class 0 OID 16539)
-- Dependencies: 226
-- Data for Name: kiosk_settings; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.kiosk_settings DISABLE TRIGGER ALL;

COPY public.kiosk_settings (id, organization_id, timeout_seconds, welcome_message, thank_you_message, logo_url, background_image_url, created_at, updated_at, allow_custom_amount, min_custom_amount, max_custom_amount, catalog_parent_id, last_catalog_sync) FROM stdin;
\.


ALTER TABLE public.kiosk_settings ENABLE TRIGGER ALL;

--
-- TOC entry 3491 (class 0 OID 49174)
-- Dependencies: 234
-- Data for Name: order_transactions; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.order_transactions DISABLE TRIGGER ALL;

COPY public.order_transactions (id, organization_id, donation_id, square_order_id, square_payment_id, order_status, payment_status, amount, currency, is_custom_amount, catalog_item_used, order_data, payment_data, created_at, updated_at) FROM stdin;
\.


ALTER TABLE public.order_transactions ENABLE TRIGGER ALL;

--
-- TOC entry 3494 (class 0 OID 57349)
-- Dependencies: 237
-- Data for Name: payment_events; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.payment_events DISABLE TRIGGER ALL;

COPY public.payment_events (id, payment_id, event_type, merchant_id, order_id, amount, created_at) FROM stdin;
\.


ALTER TABLE public.payment_events ENABLE TRIGGER ALL;

--
-- TOC entry 3489 (class 0 OID 49153)
-- Dependencies: 232
-- Data for Name: preset_donations; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.preset_donations DISABLE TRIGGER ALL;

COPY public.preset_donations (id, organization_id, amount, catalog_item_id, catalog_variation_id, is_active, display_order, created_at, updated_at) FROM stdin;
\.


ALTER TABLE public.preset_donations ENABLE TRIGGER ALL;

--
-- TOC entry 3496 (class 0 OID 90116)
-- Dependencies: 239
-- Data for Name: receipt_log; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.receipt_log DISABLE TRIGGER ALL;

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


ALTER TABLE public.receipt_log ENABLE TRIGGER ALL;

--
-- TOC entry 3492 (class 0 OID 49206)
-- Dependencies: 235
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.schema_migrations DISABLE TRIGGER ALL;

COPY public.schema_migrations (version, applied_at) FROM stdin;
20240521_catalog_integration	2025-05-21 14:57:53.923855
20250526_backend_essentials_only	2025-05-26 06:15:31.833871
\.


ALTER TABLE public.schema_migrations ENABLE TRIGGER ALL;

--
-- TOC entry 3477 (class 0 OID 16493)
-- Dependencies: 220
-- Data for Name: square_connections; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.square_connections DISABLE TRIGGER ALL;

COPY public.square_connections (id, organization_id, merchant_id, access_token, refresh_token, expires_at, created_at, updated_at, location_id, is_active, revoked_at, last_catalog_sync, api_version, device_id) FROM stdin;
193	default	MLE0CT8RWF16F	EAAAlodCGG8PT9X176lR3z8xA0IltUZxXprYYQpkLoNhVJRFNMzSciwsL2Kc-699	EQAAltggAthaLMt0JE3oNKUCSnWhQAJefQT1QvKMhOrPM6QFDpo02QyhWI16H0ud	2025-07-16 02:34:42	2025-06-11 23:56:37.38006	2025-06-16 02:34:46.70194	L96TE51REN2VG	t	\N	\N	2025-05-21	\N
\.


ALTER TABLE public.square_connections ENABLE TRIGGER ALL;

--
-- TOC entry 3498 (class 0 OID 98305)
-- Dependencies: 241
-- Data for Name: square_device_connections; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.square_device_connections DISABLE TRIGGER ALL;

COPY public.square_device_connections (id, device_id, organization_id, merchant_id, location_id, access_token, refresh_token, expires_at, is_primary_device, last_heartbeat, device_name, device_model, app_version, created_at, updated_at) FROM stdin;
\.


ALTER TABLE public.square_device_connections ENABLE TRIGGER ALL;

--
-- TOC entry 3487 (class 0 OID 24577)
-- Dependencies: 230
-- Data for Name: square_pending_tokens; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.square_pending_tokens DISABLE TRIGGER ALL;

COPY public.square_pending_tokens (id, state, access_token, refresh_token, merchant_id, expires_at, created_at, obtained, location_id, location_data, device_id) FROM stdin;
352	e87ce2e9-9e92-48c2-987b-62388aa37294	\N	\N	\N	\N	2025-06-16 02:23:21.196537	f	\N	\N	1E1FC5E6-7D73-4449-B9C0-46A48178BCC7
349	051623dc-ffb7-4c3c-beca-53e4e50e57e7	\N	\N	\N	\N	2025-06-16 02:13:12.185065	f	\N	\N	1E1FC5E6-7D73-4449-B9C0-46A48178BCC7
350	9b1ac093-fabc-484a-b652-69bcd8d32708	\N	\N	\N	\N	2025-06-16 02:13:36.281694	f	\N	\N	1E1FC5E6-7D73-4449-B9C0-46A48178BCC7
351	5acd666d-ffd6-4f4e-a90b-82b6b6ccc9bd	\N	\N	\N	\N	2025-06-16 02:22:30.238141	f	\N	\N	1E1FC5E6-7D73-4449-B9C0-46A48178BCC7
353	7bd506bf-dc41-455e-a33b-c9e33fd4532e	\N	\N	\N	\N	2025-06-16 02:30:29.616497	f	\N	\N	1E1FC5E6-7D73-4449-B9C0-46A48178BCC7
354	c136b498-0fc4-42e1-b4b9-a0bbabe5f17a	EAAAlodCGG8PT9X176lR3z8xA0IltUZxXprYYQpkLoNhVJRFNMzSciwsL2Kc-699	EQAAltggAthaLMt0JE3oNKUCSnWhQAJefQT1QvKMhOrPM6QFDpo02QyhWI16H0ud	MLE0CT8RWF16F	2025-07-16 02:34:42	2025-06-16 02:34:25.884043	f	L96TE51REN2VG	\N	1E1FC5E6-7D73-4449-B9C0-46A48178BCC7
\.


ALTER TABLE public.square_pending_tokens ENABLE TRIGGER ALL;

--
-- TOC entry 3485 (class 0 OID 16558)
-- Dependencies: 228
-- Data for Name: webhook_events; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.webhook_events DISABLE TRIGGER ALL;

COPY public.webhook_events (id, event_id, event_type, merchant_id, data, processed, created_at) FROM stdin;
\.


ALTER TABLE public.webhook_events ENABLE TRIGGER ALL;

--
-- TOC entry 3506 (class 0 OID 0)
-- Dependencies: 242
-- Name: device_coordination_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.device_coordination_events_id_seq', 1, false);


--
-- TOC entry 3507 (class 0 OID 0)
-- Dependencies: 223
-- Name: donations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.donations_id_seq', 1, false);


--
-- TOC entry 3508 (class 0 OID 0)
-- Dependencies: 225
-- Name: kiosk_settings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.kiosk_settings_id_seq', 1, false);


--
-- TOC entry 3509 (class 0 OID 0)
-- Dependencies: 233
-- Name: order_transactions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.order_transactions_id_seq', 1, false);


--
-- TOC entry 3510 (class 0 OID 0)
-- Dependencies: 221
-- Name: organizations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.organizations_id_seq', 1, false);


--
-- TOC entry 3511 (class 0 OID 0)
-- Dependencies: 236
-- Name: payment_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.payment_events_id_seq', 1, false);


--
-- TOC entry 3512 (class 0 OID 0)
-- Dependencies: 231
-- Name: preset_donations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.preset_donations_id_seq', 1, false);


--
-- TOC entry 3513 (class 0 OID 0)
-- Dependencies: 238
-- Name: receipt_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.receipt_log_id_seq', 26, true);


--
-- TOC entry 3514 (class 0 OID 0)
-- Dependencies: 219
-- Name: square_connections_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.square_connections_id_seq', 229, true);


--
-- TOC entry 3515 (class 0 OID 0)
-- Dependencies: 240
-- Name: square_device_connections_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.square_device_connections_id_seq', 1, false);


--
-- TOC entry 3516 (class 0 OID 0)
-- Dependencies: 229
-- Name: square_pending_tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.square_pending_tokens_id_seq', 354, true);


--
-- TOC entry 3517 (class 0 OID 0)
-- Dependencies: 227
-- Name: webhook_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.webhook_events_id_seq', 1, false);


-- Completed on 2025-06-15 23:28:14 EDT

--
-- PostgreSQL database dump complete
--

