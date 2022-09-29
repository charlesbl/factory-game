import React from 'react';
import '../css/Inventory.css'
import ItemStack, { ExchangeDirection } from '../Game/ItemStack';
import Inventory from '../Game/Inventory';
import IBaseProps from './IBaseProps';

interface IInventoryProps extends IBaseProps {
    inventory: Inventory
}

export default class InventoryView extends React.Component<IInventoryProps> {
    renderItemStack(itemStack: ItemStack) {
        const buyButton = itemStack.item.buyable ? <button className="green" onClick={() => itemStack.tryBuy(this.props.game)}>{itemStack.item.getBuyPrice()}</button> : "";
        const sellButton = <button className="red" onClick={() => itemStack.trySell(this.props.game)}>{itemStack.item.getSellPrice()}</button>;

        const importActivated = itemStack.exchangeDirection === ExchangeDirection.import;
        const importButton = <button className={"green dark" + (importActivated ? " darker" : "")} onClick={() => itemStack.toggleImport()}>Import</button>;

        const exportActivated = itemStack.exchangeDirection === ExchangeDirection.export;
        const exportButton = <button className={"red dark" + (exportActivated ? " darker" : "")} onClick={() => itemStack.toggleExport()}>Export</button>;
        return (
            <div className="col-6 col-sm-4 col-md-3 col-lg-2 col-xl-1" key={itemStack.id}>
                <div className="row no-gutters item">
                    <div className="col-7 text-right">
                        <span className="item-name">{itemStack.item.name}:</span>
                    </div>
                    <div className="col-5 text-left">
                        <span>{itemStack.quantity}</span>
                    </div>
                    <div className="col-12">
                        {importButton}
                        {buyButton}
                        {sellButton}
                        {exportButton}
                    </div>
                </div>
            </div>
        );
    }
    render() {
        const items = Object.entries(this.props.inventory.itemStacks).map(([id, itemStack]) => this.renderItemStack(itemStack));
        return (
            <div className="row no-gutters">
                {items}
            </div>
        );
    }
}