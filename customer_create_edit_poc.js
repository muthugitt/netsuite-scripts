    /**
     * @NApiVersion 2.1
     * @NScriptType UserEventScript
     */
    define(['N/https', 'N/log', 'N/record','N/search','N/runtime'], (https, log, record, search, runtime) => {

    const afterSubmit = (scriptContext) => {
        const { type, UserEventType, newRecord } = scriptContext;

        if (type !== UserEventType.CREATE && type !== UserEventType.EDIT) return;

        // ✅ STOP webhook loop: ignore integration contexts
        const ctx = runtime.executionContext;
        if (
        ctx === runtime.ContextType.RESTLET ||
        ctx === runtime.ContextType.REST_WEBSERVICES ||
        ctx === runtime.ContextType.SCHEDULED_SCRIPT ||
        ctx === runtime.ContextType.MAP_REDUCE ||
        ctx === runtime.ContextType.CSV_IMPORT
        ) {
        log.debug({
            title: 'Webhook skipped (integration execution context)',
            details: `Customer ${newRecord.id} | executionContext=${ctx}`
        });
        return;
        }
        if (type === UserEventType.EDIT && scriptContext.oldRecord) {
        const oldSyrinx = scriptContext.oldRecord.getValue({ fieldId: 'custentitysyrinx_id' }) || '';
        const newSyrinx = newRecord.getValue({ fieldId: 'custentitysyrinx_id' }) || '';

        if (oldSyrinx !== newSyrinx) return; // skip if only Syrinx ID was updated
       }
        
        //DEV URL
        //const webhookUrl = 'https://webhooks.au.workato.com/webhooks/rest/b3f8b648-685a-496e-b572-b2a05b2f1c7a/netsuite_syrinx_customer_event';
        //TEST URL
        const webhookUrl =  'https://webhooks.au.workato.com/webhooks/rest/2f629bd4-d775-4676-a97c-6c2c99c4b987/netsuite_syrinx_customer_event';

        try {
            const customerObj = record.load({
                type: newRecord.type,
                id: newRecord.id
            });
            
           // ================================
            // 1. Syrinx Customer Gate (ONLY rule)
            // ================================
            //const isSyrinxCustomer = customerObj.getValue({ fieldId: 'custentity28' });

            // Fire webhook ONLY if field has a value
            //if (!isSyrinxCustomer) {
                //log.debug({
                    //title: 'Webhook skipped',
                    //details: `Customer ${customerObj.id} is not marked as Syrinx customer`
                //});
                //return;
            //}
            // =========================================================
            // NEW: Terms -> customerType mapping
            // If Terms = "Due on receipt" => "C"
            // Else => "A"
            // =========================================================
            const termsText = (customerObj.getText({ fieldId: 'terms' }) || '').toLowerCase().trim();
            const type = (termsText === 'due on receipt') ? 'C' : 'A';

            // 1. Prepare Payload //Change payload to body
            const body = {
                event: type,
                customerId: customerObj.id,
                entityId: customerObj.getValue({ fieldId: 'entityid' }) || '',
                companyName: customerObj.getValue({ fieldId: 'companyname' }) || '',
                email: customerObj.getValue({ fieldId: 'email' }) || '',
                phone: customerObj.getValue({ fieldId: 'phone' }) || '',
                salesRep: customerObj.getText({ fieldId: 'salesrep' }) || '',
                department: customerObj.getText({ fieldId: 'department' }) || '',
                // NEW: Syrinx ID
                syrinxId: customerObj.getValue({ fieldId: 'custentitysyrinx_id' }) || '',
                //isSyrinxCustomer: customerObj.getValue({ fieldId: 'custentity28' }) || '',
                isSyrinxCustomer: !!customerObj.getValue({ fieldId: 'custentity28' }),
                type: type,
                

                 
                abn: customerObj.getValue({ fieldId: 'vatregnumber' }) || '', 
                financials: {
                    balance: customerObj.getValue({ fieldId: 'balance' }) || 0,
                    creditHold: customerObj.getValue({ fieldId: 'creditholdoverride' }) || '', 
                    creditLimit: customerObj.getValue({ fieldId: 'creditlimit' }) || 0,
                    // NEW: Payment terms (dropdown)
                    paymentTermsId: customerObj.getValue({ fieldId: 'terms' }) || '',
                    paymentTermsText: customerObj.getText({ fieldId: 'terms' }) || '',
                    // ✅ NEW: HOLD dropdown
                    //holdId: customerObj.getValue({ fieldId: 'creditholdoverride' }) || '',
                    //holdText: customerObj.getText({ fieldId: 'creditholdoverride' }) || ''
                },
                addresses: [],
                contacts: [] // NEW: Contacts Array
            };

            // 2. Extract Address Data
            const addrCount = customerObj.getLineCount({ sublistId: 'addressbook' });

            for (let i = 0; i < addrCount; i++) {

                const addressId = customerObj.getSublistValue({
                    sublistId: 'addressbook',
                    fieldId: 'id',   // ⭐ THIS is the Address ID
                    line: i
                });

                const addressSubrecord = customerObj.getSublistSubrecord({
                    sublistId: 'addressbook',
                    fieldId: 'addressbookaddress',
                    line: i
                });

                if (addressSubrecord) {
                    body.addresses.push({
                        addressId: addressId, // ⭐ Capture it here
                        label: customerObj.getSublistValue({
                            sublistId: 'addressbook',
                            fieldId: 'label',
                            line: i
                        }),
                        isDefaultShipping: customerObj.getSublistValue({
                            sublistId: 'addressbook',
                            fieldId: 'defaultshipping',
                            line: i
                        }),
                        isDefaultBilling: customerObj.getSublistValue({
                            sublistId: 'addressbook',
                            fieldId: 'defaultbilling',
                            line: i
                        }),
                        addr1: addressSubrecord.getValue({ fieldId: 'addr1' }) || '',
                        addr2: addressSubrecord.getValue({ fieldId: 'addr2' }) || '',
                        city: addressSubrecord.getValue({ fieldId: 'city' }) || '',
                        state: addressSubrecord.getValue({ fieldId: 'state' }) || '',
                        zip: addressSubrecord.getValue({ fieldId: 'zip' }) || '',
                        country: addressSubrecord.getText({ fieldId: 'country' }) || ''
                    });
                }
            }


            // 3. NEW: Extract Contact Data
            // Note: Use 'contacts' sublist for Customer records
            // 3. Extract Contact Data (CORRECT way)
           const contactSearch = search.create({
           type: search.Type.CONTACT,
            filters: [
            ['company', 'anyof', customerObj.id]
            ],
            columns: [
            'internalid',
            'entityid',
            'title',
            'phone',
            'email',
            'custentitysyrinx_contact_id',
             'firstname',
             'lastname'
            ]
        });

contactSearch.run().each(result => {
    body.contacts.push({
        contactId: result.getValue('internalid'),
        name: result.getValue('entityid') || '',
        jobTitle: result.getValue('title') || '',
        phone: result.getValue('phone') || '',
        email: result.getValue('email') || '',
        syrinxContactId: result.getValue('custentitysyrinx_contact_id') || '',
        firstName: result.getValue({ name: 'firstname' }) || '',
        lastName: result.getValue({ name: 'lastname' }) || ''
    });
    return true;
});



            // 4. Send to Workato
            const response = https.post({
                url: webhookUrl,
                body: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json' }
            });

            log.debug({
                title: `Sync Success: ${type}`,
                details: `Status: ${response.code} | ID: ${customerObj.id}`
            });

        } catch (e) {
            log.error({
                title: 'Webhook Sync Failed',
                details: `Error: ${e.message}`
            });
        }
    };

    return { afterSubmit };
});