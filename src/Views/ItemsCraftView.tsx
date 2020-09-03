import React from 'react';
import ItemStack from '../Game/ItemStack';

interface IItemsCraftProps {
    itemStacks: ItemStack[];
    craftDuration?: number;
}

export default class ItemsCraftView extends React.Component<IItemsCraftProps> {

    renderItemStack(itemStack: ItemStack) {
        var rateDiv;
        if (this.props.craftDuration) {
            var rate = itemStack.quantity / this.props.craftDuration * 1000;
            rateDiv = <div>{rate.toFixed(2)}/s</div>;
        }
        return (
            <div key={itemStack.id} className="item">
                <div>{this.props.craftDuration ? itemStack.quantity : ""} {itemStack.item.name}</div>
                {rateDiv}
            </div>
        );
    }

    render() {
        return (
            <div className="item-list">
                {this.props.itemStacks.map((itemStack) => this.renderItemStack(itemStack))}
            </div>
        );
    }
}