/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/https', 'N/log', 'N/record', 'N/search'], (https, log, record, search) => {

  const afterSubmit = (scriptContext) => {
    const { type, UserEventType, newRecord, oldRecord } = scriptContext;

    if (
      type !== UserEventType.CREATE &&
      type !== UserEventType.EDIT &&
      type !== UserEventType.DELETE
    ) return;

    // TEST URL
    const webhookUrl = 'https://webhooks.au.workato.com/webhooks/rest/2f629bd4-d775-4676-a97c-6c2c99c4b987/netsuite_contact_event';

    const safeGetValue = (rec, fieldId) => {
      try { return rec.getValue({ fieldId }) || ''; }
      catch (e) { return ''; }
    };

    const safeGetText = (rec, fieldId) => {
      try { return rec.getText({ fieldId }) || ''; }
      catch (e) { return ''; }
    };

    const getDefaultBillingAddr1 = (custId) => {
      try {
        if (!custId) return '';

        const s = search.create({
          type: search.Type.CUSTOMER,
          filters: [
            ['internalid', 'anyof', custId],
            'AND',
            ['addressbook.defaultbill', 'is', 'T']
          ],
          columns: [
            search.createColumn({ name: 'address1', join: 'Address' })
          ]
        });

        const res = s.run().getRange({ start: 0, end: 1 });
        if (!res || res.length === 0) return '';

        return res[0].getValue({ name: 'address1', join: 'Address' }) || '';
      } catch (e) {
        log.debug({ title: 'Default Billing Address Lookup Failed', details: e.message });
        return '';
      }
    };

    const getAnyAddr1 = (custId) => {
      try {
        if (!custId) return '';

        const s = search.create({
          type: search.Type.CUSTOMER,
          filters: [['internalid', 'anyof', custId]],
          columns: [search.createColumn({ name: 'address1', join: 'Address' })]
        });

        const res = s.run().getRange({ start: 0, end: 1 });
        return (res && res[0]) ? (res[0].getValue({ name: 'address1', join: 'Address' }) || '') : '';
      } catch (e) {
        return '';
      }
    };

    try {
      // For delete, use oldRecord. For create/edit, use newRecord.
      const contactObj = (type === UserEventType.DELETE) ? oldRecord : newRecord;

      if (!contactObj) {
        log.error({
          title: 'Missing source record',
          details: `No record available for event type ${type}`
        });
        return;
      }

      // Linked customer
      const customerId = safeGetValue(contactObj, 'company');
      let customerObj = null;

      let customerEntityId = safeGetText(contactObj, 'company') || '';
      let customerCompanyName = customerEntityId;
      let customerEmail = '';
      let customerPhone = '';
      let customerSalesRep = '';
      let customerDepartment = '';
      let customerSyrinxId = '';
      let customerIsSyrinxCustomer = '';
      let customerType = '';
      let customerAbn = '';

      let balance = '';
      let creditHold = '';
      let creditLimit = '';
      let billingAddr1 = '';

      if (customerId) {
        // Customer record should still exist even if contact is deleted
        customerObj = record.load({
          type: record.Type.CUSTOMER,
          id: customerId
        });

        customerEntityId = safeGetValue(customerObj, 'entityid') || customerEntityId;
        customerCompanyName = safeGetValue(customerObj, 'companyname') || customerEntityId;

        customerEmail = safeGetValue(customerObj, 'email');
        customerPhone = safeGetValue(customerObj, 'phone');
        customerSalesRep = safeGetText(customerObj, 'salesrep');
        customerDepartment = safeGetText(customerObj, 'department');

        customerSyrinxId = safeGetValue(customerObj, 'custentitysyrinx_id');
        customerIsSyrinxCustomer = safeGetValue(customerObj, 'custentity28');

        customerAbn = safeGetValue(customerObj, 'custentity_abn') || safeGetValue(customerObj, 'vatregnumber');

        balance = safeGetValue(customerObj, 'balance');
        creditHold = safeGetValue(customerObj, 'credithold');
        creditLimit = safeGetValue(customerObj, 'creditlimit');

        const termsText = (safeGetText(customerObj, 'terms') || '').toLowerCase().trim();
        customerType = (termsText === 'due on receipt') ? 'C' : 'A';

        billingAddr1 = getDefaultBillingAddr1(customerId) || getAnyAddr1(customerId);
      }

      const isDeleted = type === UserEventType.DELETE;

      const bodyToSend = {
        event: type,              // CREATE / EDIT / DELETE
        isDeleted: isDeleted,     // true only for deletes

        customerId: customerId || '',
        entityId: customerEntityId || '',
        companyName: customerCompanyName || '',
        email: customerEmail || '',
        phone: customerPhone || '',
        salesRep: customerSalesRep || '',
        department: customerDepartment || '',
        syrinxId: customerSyrinxId || '',
        isSyrinxCustomer: customerIsSyrinxCustomer === '' ? false : !!customerIsSyrinxCustomer,
        type: customerType || '',
        abn: customerAbn || '',

        financials: {
          balance: balance === '' ? 0 : balance,
          creditHold: creditHold === '' ? '' : creditHold,
          creditLimit: creditLimit === '' ? 0 : creditLimit
        },

        addresses: [
          { addr1: billingAddr1 || '' }
        ],

        contacts: [
          {
            contactId: contactObj.id,
            name: safeGetValue(contactObj, 'entityid'),
            jobTitle: safeGetText(contactObj, 'title'),
            phone: safeGetValue(contactObj, 'phone'),
            email: safeGetValue(contactObj, 'email'),
            syrinxContactId: safeGetValue(contactObj, 'custentitysyrinx_contact_id'),
            firstName: safeGetValue(contactObj, 'firstname'),
            lastName: safeGetValue(contactObj, 'lastname'),
            current: !isDeleted
          }
        ]
      };

      log.debug({
        title: `Payload Prepared: ${type}`,
        details: JSON.stringify(bodyToSend)
      });

      const response = https.post({
        url: webhookUrl,
        body: JSON.stringify(bodyToSend),
        headers: { 'Content-Type': 'application/json' }
      });

      log.debug({
        title: 'Workato Contact Sync Response',
        details: `Status Code: ${response.code} | Body: ${response.body}`
      });

    } catch (e) {
      log.error({
        title: 'Contact Webhook Failed',
        details: `Error: ${e.message} | Stack: ${e.stack}`
      });
    }
  };

  return { afterSubmit };
});