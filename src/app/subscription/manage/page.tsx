'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

interface SubscriptionDetails {
  id: string
  status: string
  plan_type: string
  device_count: number
  total_price: number
  next_billing_date: string
  card_last_four: string
}

export default function ManagePage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const orgId = searchParams.get('org_id') || 'default'
  
  const [subscription, setSubscription] = useState<SubscriptionDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  useEffect(() => {
    fetchSubscriptionDetails()
  }, [orgId])
  
  async function fetchSubscriptionDetails() {
    try {
      const response = await fetch(`/api/subscriptions/status?organization_id=${orgId}`)
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
    if (!confirm('Are you sure you want to cancel your subscription?')) return
    
    try {
      const response = await fetch('/api/subscriptions/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: orgId })
      })
      
      if (!response.ok) throw new Error('Failed to cancel subscription')
      
      alert('Subscription cancelled successfully')
      router.push(`shulpad://subscription/cancelled?org_id=${orgId}`)
    } catch (err) {
      alert('Failed to cancel subscription')
    }
  }
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading subscription details...</p>
        </div>
      </div>
    )
  }
  
  if (error || !subscription) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">No Active Subscription</h1>
          <p className="text-gray-600 mb-8">{error || 'You don\'t have an active subscription.'}</p>
          <a
            href={`/subscription/checkout?org_id=${orgId}`}
            className="inline-block py-3 px-6 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            Subscribe Now
          </a>
        </div>
      </div>
    )
  }
  
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-md mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8 text-center">
          Manage Subscription
        </h1>
        
        <div className="bg-white rounded-lg shadow divide-y">
          {/* Subscription Status */}
          <div className="p-6">
            <h2 className="text-lg font-semibold mb-4">Subscription Details</h2>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-gray-600">Status</dt>
                <dd className="font-medium">
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    subscription.status === 'active' 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {subscription.status.toUpperCase()}
                  </span>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Plan</dt>
                <dd className="font-medium capitalize">{subscription.plan_type}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Devices</dt>
                <dd className="font-medium">{subscription.device_count}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Price</dt>
                <dd className="font-medium">
                  ${subscription.total_price}/{subscription.plan_type === 'monthly' ? 'month' : 'year'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Next Billing</dt>
                <dd className="font-medium">
                  {new Date(subscription.next_billing_date).toLocaleDateString()}
                </dd>
              </div>
            </dl>
          </div>
          
          {/* Payment Method */}
          <div className="p-6">
            <h2 className="text-lg font-semibold mb-4">Payment Method</h2>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-8 bg-gray-200 rounded flex items-center justify-center text-xs font-mono">
                  ****
                </div>
                <span className="text-gray-600">
                  Card ending in {subscription.card_last_four}
                </span>
              </div>
              <button className="text-blue-600 hover:text-blue-800 text-sm">
                Update
              </button>
            </div>
          </div>
          
          {/* Actions */}
          <div className="p-6 space-y-3">
            <button
              onClick={() => router.push(`/subscription/checkout?org_id=${orgId}&plan=${subscription.plan_type}&devices=${subscription.device_count}`)}
              className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              Change Plan
            </button>
            <button
              onClick={handleCancelSubscription}
              className="w-full py-2 px-4 border border-red-600 text-red-600 rounded-lg hover:bg-red-50 font-medium"
            >
              Cancel Subscription
            </button>
          </div>
        </div>
        
        {/* Return to App */}
        <div className="mt-8 text-center">
          <a
            href={`shulpad://subscription/manage?org_id=${orgId}`}
            className="text-blue-600 hover:text-blue-800"
          >
            Return to ShulPad
          </a>
        </div>
      </div>
    </div>
  )
}