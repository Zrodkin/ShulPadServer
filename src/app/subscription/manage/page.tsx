// src/app/subscription/manage/page.tsx - MINIMAL FIX
'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Head from 'next/head'

interface SubscriptionDetails {
  id: string
  status: string
  plan_type: string
  device_count: number
  total_price: number
  next_billing_date: string
  card_last_four: string
}

function ManagePageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const merchantId = searchParams.get('merchant_id') || 'default'
  
  const [subscription, setSubscription] = useState<SubscriptionDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  useEffect(() => {
    fetchSubscriptionDetails()
  }, [merchantId])
  
  async function fetchSubscriptionDetails() {
    try {
      const response = await fetch(`/api/subscriptions/status?merchant_id=${merchantId}`)
      if (!response.ok) throw new Error('Failed to fetch subscription')
      
      const data = await response.json()
      if (data.subscription) {
        setSubscription(data.subscription)
      } else {
        setError('No active subscription found')
      }
    } catch (err) {
      setError('Failed to load subscription details')
    } finally {
      setIsLoading(false)
    }
  }
  
  async function handleCancelSubscription() {
    if (!confirm('Are you sure you want to cancel your subscription?'))
      return
      
    try {
      const response = await fetch('/api/subscriptions/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant_id: merchantId })
      })
      
      if (!response.ok) throw new Error('Failed to cancel subscription')
      
      alert('Subscription cancelled successfully')
      router.push(`shulpad://subscription/cancelled?merchant_id=${merchantId}`)
    } catch (err) {
      alert('Failed to cancel subscription')
    }
  }
  
  if (isLoading) {
    return (
      <>
        <Head>
          <title>ShulPad Subscription - Loading</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
          <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
          <script src="https://cdn.tailwindcss.com"></script>
          <link rel="stylesheet" href="/safari-fallback.css" />
        </Head>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading subscription details...</p>
          </div>
        </div>
      </>
    )
  }
  
  if (error || !subscription) {
    return (
      <>
        <Head>
          <title>ShulPad Subscription - No Active Subscription</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
          <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
          <script src="https://cdn.tailwindcss.com"></script>
          <link rel="stylesheet" href="/safari-fallback.css" />
        </Head>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
          <div className="max-w-md w-full text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">No Active Subscription</h1>
            <p className="text-gray-600 mb-8">{error || 'You don\'t have an active subscription.'}</p>
            <a
              href={`/subscription/checkout?org_id=${merchantId}`}
              className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Subscribe Now
            </a>
          </div>
        </div>
      </>
    )
  }
  
  return (
    <>
      <Head>
        <title>ShulPad Subscription - Manage</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="format-detection" content="telephone=no" />
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="/safari-fallback.css" />
      </Head>
      
      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-md mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8 text-center">
            Manage Subscription
          </h1>
          
          <div className="bg-white rounded-lg shadow overflow-hidden">
            {/* Subscription Status */}
            <div className="p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Subscription Details
              </h2>
              
              <div className="space-y-3">
                <div className="flex justify-between py-2 border-b border-gray-100">
                  <span className="text-gray-600">Status</span>
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold uppercase ${
                    subscription.status === 'active' 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {subscription.status}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-100">
                  <span className="text-gray-600">Plan</span>
                  <span className="font-medium capitalize">
                    {subscription.plan_type}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-100">
                  <span className="text-gray-600">Devices</span>
                  <span className="font-medium">{subscription.device_count}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-100">
                  <span className="text-gray-600">Price</span>
                  <span className="font-medium">
                    ${subscription.total_price}/{subscription.plan_type === 'monthly' ? 'month' : 'year'}
                  </span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-gray-600">Next Billing</span>
                  <span className="font-medium">
                    {new Date(subscription.next_billing_date).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
            
            {/* Payment Method */}
            <div className="p-6 border-t border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Payment Method
              </h2>
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="w-12 h-8 bg-gray-100 rounded flex items-center justify-center text-xs font-mono mr-3">
                    ****
                  </div>
                  <span className="text-gray-600">
                    Card ending in {subscription.card_last_four}
                  </span>
                </div>
                <button className="text-blue-600 text-sm hover:text-blue-800 underline">
                  Update
                </button>
              </div>
            </div>
            
            {/* Actions */}
            <div className="p-6 border-t border-gray-200">
              <button
                onClick={() => router.push(`/subscription/checkout?org_id=${merchantId}&plan=${subscription.plan_type}&devices=${subscription.device_count}`)}
                className="w-full mb-3 px-4 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                Change Plan
              </button>
              <button
                onClick={handleCancelSubscription}
                className="w-full px-4 py-2 bg-white text-red-600 border border-red-600 rounded-lg font-medium hover:bg-red-50 transition-colors"
              >
                Cancel Subscription
              </button>
            </div>
          </div>
          
          {/* Return to App */}
          <div className="mt-8 text-center">
            <a
              href={`shulpad://subscription/manage?org_id=${merchantId}`}
              className="text-blue-600 hover:text-blue-800 underline"
            >
              Return to ShulPad
            </a>
          </div>
        </div>
      </div>
    </>
  )
}

export default function ManagePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <ManagePageContent />
    </Suspense>
  )
}