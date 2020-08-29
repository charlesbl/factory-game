import React from 'react';
import '../css/Inventory.css'
import ItemStack from '../Game/ItemStack';
import Inventory from '../Game/Inventory';
import IBaseProps from './IBaseProps';

interface IInventoryProps extends IBaseProps {
    inventory: Inventory
}

export default class InventoryView extends React.Component<IInventoryProps> {
    renderItemStack(itemStack: ItemStack) {
        var buyButton = itemStack.item.cost ? <button onClick={() => itemStack.tryBuy(this.props.game)}>{itemStack.item.cost}</button> : "";
        return (
            <div className="col-6 col-sm-4 col-md-3 col-lg-2 col-xl-1" key={itemStack.id}>
                <div className="row no-gutters item">
                    <div className="col-7 text-right">
                        <span className="item-name">{itemStack.item.name}:</span>
                    </div>
                    <div className="col-5 text-left">
                        <span>{itemStack.quantity}</span>
                        {buyButton}
                    </div>
                </div>
            </div>
        );
    }
    render() {
        var items = Object.entries(this.props.inventory.itemStacks).filter(([id, itemStack]) => !itemStack.item.infinite).map(([id, itemStack]) => this.renderItemStack(itemStack));
        return (
            <div className="row no-gutters">
                {items}
            </div>
        );
    }
}